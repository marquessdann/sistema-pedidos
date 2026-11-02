import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CLIENT_STATUSES, normalizeCnpj, parseClientText, UFS } from '@della/shared';
import { prisma } from '../../db';
import { actor } from '../../lib/auth';
import { audit, diff } from '../../lib/audit';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { cepOpt, cnpjSchema, emailOpt, optText, pageArgs, paged, paginationSchema, phoneOpt, reqText } from '../../lib/validation';

export const clientSchema = z.object({
  legalName: reqText(200),
  tradeName: optText(200),
  cnpj: cnpjSchema,
  stateRegistration: optText(30),
  responsibleName: optText(120),
  financeEmail: emailOpt,
  financePhone: phoneOpt,
  commercialPhone: phoneOpt,
  commercialEmail: emailOpt,
  cep: cepOpt,
  state: z.enum(UFS).nullish().transform((v) => v ?? null),
  city: optText(100),
  district: optText(100),
  street: optText(200),
  number: optText(20),
  complement: optText(100),
  notes: optText(2000),
  status: z.enum(CLIENT_STATUSES).default('PENDING_REGISTRATION'),
  salesRepId: z.string().uuid().nullish().transform((v) => v ?? null),
  availableToAllReps: z.boolean().default(false),
});

async function userNames(ids: (string | null)[]) {
  const valid = ids.filter((x): x is string => !!x);
  const users = await prisma.user.findMany({ where: { id: { in: valid } }, select: { id: true, name: true } });
  return Object.fromEntries(users.map((u) => [u.id, u.name]));
}

async function validateClient(data: z.infer<typeof clientSchema>, excludeId?: string) {
  if (data.status === 'ACTIVE' && !data.salesRepId && !data.availableToAllReps) {
    throw unprocessable('Para ativar o cliente, defina o vendedor responsável ou libere para todos os vendedores.', 'CLIENT_NEEDS_REP');
  }
  if (data.salesRepId) {
    const rep = await prisma.salesRep.findFirst({ where: { id: data.salesRepId, deletedAt: null } });
    if (!rep) throw unprocessable('Vendedor responsável inválido.');
  }
  const dup = await prisma.client.findFirst({ where: { cnpj: data.cnpj, ...(excludeId ? { id: { not: excludeId } } : {}) } });
  if (dup) throw conflict(`Já existe um cliente com este CNPJ: ${dup.legalName}.`, 'DUPLICATE_CNPJ', { clientId: dup.id });
}

export async function adminClientRoutes(app: FastifyInstance) {
  app.get('/clients', async (req) => {
    const q = paginationSchema
      .extend({
        q: z.string().trim().max(100).optional(),
        status: z.enum(CLIENT_STATUSES).optional(),
        salesRepId: z.string().uuid().optional(),
        sort: z.enum(['name', 'recent']).default('name'),
      })
      .parse(req.query);
    const where = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.salesRepId ? { salesRepId: q.salesRepId } : {}),
      ...(q.q
        ? {
            OR: [
              { legalName: { contains: q.q, mode: 'insensitive' as const } },
              { tradeName: { contains: q.q, mode: 'insensitive' as const } },
              { responsibleName: { contains: q.q, mode: 'insensitive' as const } },
              { city: { contains: q.q, mode: 'insensitive' as const } },
              ...(normalizeCnpj(q.q).length >= 3 ? [{ cnpj: { contains: normalizeCnpj(q.q) } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: { salesRep: { select: { id: true, fullName: true } } },
        orderBy: q.sort === 'recent' ? { createdAt: 'desc' } : { legalName: 'asc' },
        ...pageArgs(q),
      }),
      prisma.client.count({ where }),
    ]);
    return paged(items, total, q);
  });

  app.get('/clients/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = await prisma.client.findUnique({ where: { id }, include: { salesRep: { select: { id: true, fullName: true } } } });
    if (!c) throw notFound('Cliente');
    const names = await userNames([c.createdById, c.updatedById]);
    const stats = await prisma.order.aggregate({
      where: { clientId: id, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] } },
      _count: true,
      _sum: { totalCents: true },
      _max: { orderDate: true },
    });
    return {
      ...c,
      createdByName: c.createdById ? names[c.createdById] ?? null : null,
      updatedByName: c.updatedById ? names[c.updatedById] ?? null : null,
      stats: { orders: stats._count, totalCents: stats._sum.totalCents ?? 0, lastOrderDate: stats._max.orderDate?.toISOString().slice(0, 10) ?? null },
    };
  });

  app.post('/clients/parse-text', async (req) => {
    const { text } = z.object({ text: z.string().max(10_000) }).parse(req.body);
    return parseClientText(text);
  });

  app.post('/clients/check-duplicate', async (req) => {
    const b = z.object({ cnpj: z.string().optional(), legalName: z.string().optional(), excludeId: z.string().uuid().optional() }).parse(req.body);
    const cnpj = normalizeCnpj(b.cnpj);
    const notSelf = b.excludeId ? { id: { not: b.excludeId } } : {};
    const byCnpj = cnpj.length === 14 ? await prisma.client.findFirst({ where: { cnpj, ...notSelf }, select: { id: true, legalName: true, cnpj: true, status: true } }) : null;
    const name = (b.legalName ?? '').trim();
    const similar =
      name.length >= 4
        ? await prisma.client.findMany({
            where: { ...notSelf, OR: [{ legalName: { contains: name.split(/\s+/).slice(0, 2).join(' '), mode: 'insensitive' } }, { tradeName: { contains: name, mode: 'insensitive' } }] },
            select: { id: true, legalName: true, cnpj: true, status: true },
            take: 5,
          })
        : [];
    return { cnpjDuplicate: byCnpj, similarNames: similar.filter((s) => s.id !== byCnpj?.id) };
  });

  app.post('/clients', async (req, reply) => {
    const data = clientSchema.parse(req.body);
    await validateClient(data);
    const c = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({ data: { ...data, createdById: req.user!.id, updatedById: req.user!.id } });
      await audit(tx, actor(req), 'CLIENT_CREATED', 'client', created.id, data);
      return created;
    });
    return reply.status(201).send(c);
  });

  app.put('/clients/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = clientSchema.parse(req.body);
    const before = await prisma.client.findUnique({ where: { id } });
    if (!before) throw notFound('Cliente');
    await validateClient(data, id);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.client.update({ where: { id }, data: { ...data, updatedById: req.user!.id } });
      const changes = diff(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
      await audit(tx, actor(req), before.status !== data.status ? 'CLIENT_STATUS_CHANGED' : 'CLIENT_UPDATED', 'client', id, changes);
      return updated;
    });
  });
}
