import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db';
import { actor, destroyUserSessions } from '../../lib/auth';
import { audit, diff } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { bpsSchema, cpfOpt, emailOpt, optText, passwordSchema, phoneOpt, reqText } from '../../lib/validation';

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'O usuário deve ter pelo menos 3 caracteres.')
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Use apenas letras minúsculas, números, ponto, hífen ou sublinhado.');

const repBase = z.object({
  fullName: reqText(120),
  title: z.string().trim().max(80).default('Representante comercial'),
  cpf: cpfOpt,
  phone: phoneOpt,
  contactPhone: phoneOpt,
  email: emailOpt,
  commissionBps: bpsSchema.nullish().transform((v) => v ?? null),
  maxDiscountBps: bpsSchema.default(0),
  canViewAllOrders: z.boolean().default(false),
  canViewCost: z.boolean().default(false),
  canViewClientTotals: z.boolean().default(true),
  canViewFinanceContact: z.boolean().default(false),
  notes: optText(2000),
});

function serialize(rep: Awaited<ReturnType<typeof loadRep>>) {
  if (!rep) return null;
  const { user, ...r } = rep;
  return { ...r, username: user.username, active: user.active, lastLoginAt: user.lastLoginAt, mustChangePassword: user.mustChangePassword, lockedUntil: user.lockedUntil };
}

function loadRep(id: string) {
  return prisma.salesRep.findUnique({ where: { id }, include: { user: true } });
}

export async function adminRepRoutes(app: FastifyInstance) {
  app.get('/reps', async () => {
    const reps = await prisma.salesRep.findMany({ where: { deletedAt: null }, include: { user: true }, orderBy: { fullName: 'asc' } });
    const counts = await prisma.client.groupBy({ by: ['salesRepId'], where: { deletedAt: null }, _count: true });
    const map = Object.fromEntries(counts.map((c) => [c.salesRepId, c._count]));
    return reps.map((r) => ({ ...serialize(r)!, clientCount: map[r.id] ?? 0 }));
  });

  app.get('/reps/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rep = await loadRep(id);
    if (!rep || rep.deletedAt) throw notFound('Vendedor');
    return serialize(rep);
  });

  app.post('/reps', async (req, reply) => {
    const body = repBase.extend({ username: usernameSchema, password: passwordSchema, active: z.boolean().default(true) }).parse(req.body);
    const { username, password, active, ...repData } = body;
    if (await prisma.user.findUnique({ where: { username } })) throw conflict('Este nome de usuário já está em uso.', 'DUPLICATE_USERNAME');
    if (repData.cpf && (await prisma.salesRep.findUnique({ where: { cpf: repData.cpf } }))) throw conflict('Já existe um vendedor com este CPF.', 'DUPLICATE_CPF');
    const passwordHash = await hashPassword(password);
    const rep = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { username, passwordHash, name: repData.fullName, role: 'SELLER', active, mustChangePassword: true } });
      const created = await tx.salesRep.create({ data: { ...repData, userId: user.id } });
      await audit(tx, actor(req), 'REP_CREATED', 'sales_rep', created.id, { ...repData, username, active });
      return created;
    });
    return reply.status(201).send(serialize(await loadRep(rep.id)));
  });

  app.put('/reps/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = repBase.parse(req.body);
    const before = await loadRep(id);
    if (!before || before.deletedAt) throw notFound('Vendedor');
    if (data.cpf && (await prisma.salesRep.findFirst({ where: { cpf: data.cpf, id: { not: id } } }))) throw conflict('Já existe um vendedor com este CPF.', 'DUPLICATE_CPF');
    await prisma.$transaction(async (tx) => {
      await tx.salesRep.update({ where: { id }, data });
      await tx.user.update({ where: { id: before.userId }, data: { name: data.fullName } });
      const changes = diff(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
      await audit(tx, actor(req), changes.maxDiscountBps ? 'REP_DISCOUNT_LIMIT_CHANGED' : 'REP_UPDATED', 'sales_rep', id, changes);
    });
    return serialize(await loadRep(id));
  });

  app.post('/reps/:id/active', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const rep = await loadRep(id);
    if (!rep || rep.deletedAt) throw notFound('Vendedor');
    await prisma.user.update({ where: { id: rep.userId }, data: { active, ...(active ? { lockedUntil: null, failedLoginCount: 0 } : {}) } });
    if (!active) await destroyUserSessions(rep.userId);
    await audit(prisma, actor(req), active ? 'REP_ACTIVATED' : 'REP_BLOCKED', 'sales_rep', id);
    return serialize(await loadRep(id));
  });

  app.post('/reps/:id/reset-password', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { password } = z.object({ password: passwordSchema }).parse(req.body);
    const rep = await loadRep(id);
    if (!rep || rep.deletedAt) throw notFound('Vendedor');
    await prisma.user.update({
      where: { id: rep.userId },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true, lockedUntil: null, failedLoginCount: 0 },
    });
    await destroyUserSessions(rep.userId);
    await audit(prisma, actor(req), 'REP_PASSWORD_RESET', 'sales_rep', id);
    return { ok: true };
  });

  // Administradores e gestores
  app.get('/users', async () =>
    prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
        mustChangePassword: true,
        managerProfile: { include: { reps: { select: { salesRepId: true } } } },
      },
    }),
  );

  const managerSchema = z.object({
    canViewSales: z.boolean().default(true),
    canViewCommissions: z.boolean().default(true),
    canReleaseProducts: z.boolean().default(true),
    canReleaseClients: z.boolean().default(true),
    canApproveDiscounts: z.boolean().default(false),
    canUpdateOrderStatus: z.boolean().default(false),
    repIds: z.array(z.string().uuid()).max(100).default([]),
  });

  app.post('/users', async (req, reply) => {
    const b = z
      .object({ username: usernameSchema, name: reqText(120), password: passwordSchema, role: z.enum(['ADMIN', 'MANAGER']).default('ADMIN'), manager: managerSchema.optional() })
      .parse(req.body);
    if (await prisma.user.findUnique({ where: { username: b.username } })) throw conflict('Este nome de usuário já está em uso.', 'DUPLICATE_USERNAME');
    const passwordHash = await hashPassword(b.password);
    const u = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { username: b.username, name: b.name, role: b.role, passwordHash, mustChangePassword: true },
        select: { id: true, username: true, name: true, role: true, active: true },
      });
      if (b.role === 'MANAGER') {
        const { repIds, ...perms } = managerSchema.parse(b.manager ?? {});
        await tx.managerProfile.create({ data: { userId: created.id, ...perms, reps: { create: repIds.map((salesRepId) => ({ salesRepId })) } } });
      }
      await audit(tx, actor(req), b.role === 'MANAGER' ? 'MANAGER_CREATED' : 'ADMIN_CREATED', 'user', created.id, { username: created.username, name: created.name, manager: b.manager });
      return created;
    });
    return reply.status(201).send(u);
  });

  app.put('/users/:id/manager', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { repIds, ...perms } = managerSchema.parse(req.body);
    const u = await prisma.user.findUnique({ where: { id }, include: { managerProfile: true } });
    if (!u || u.role !== 'MANAGER' || !u.managerProfile) throw notFound('Gestor');
    const reps = await prisma.salesRep.count({ where: { id: { in: repIds }, deletedAt: null } });
    if (reps !== repIds.length) throw conflict('Vendedor inválido na lista de supervisionados.');
    await prisma.$transaction(async (tx) => {
      await tx.managerProfile.update({ where: { id: u.managerProfile!.id }, data: perms });
      await tx.managerRep.deleteMany({ where: { managerId: u.managerProfile!.id } });
      await tx.managerRep.createMany({ data: repIds.map((salesRepId) => ({ managerId: u.managerProfile!.id, salesRepId })) });
      await audit(tx, actor(req), 'MANAGER_PERMISSIONS_CHANGED', 'user', id, { ...perms, repIds });
    });
    return { ok: true };
  });

  app.post('/users/:id/reset-password', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { password } = z.object({ password: passwordSchema }).parse(req.body);
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u || u.role === 'SELLER') throw notFound('Usuário');
    if (id === req.user!.id) throw conflict('Para trocar a sua própria senha use “Minha conta”.');
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, lockedUntil: null, failedLoginCount: 0 } });
    await destroyUserSessions(id);
    await audit(prisma, actor(req), 'USER_PASSWORD_RESET', 'user', id);
    return { ok: true };
  });

  app.post('/users/:id/active', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    if (id === req.user!.id) throw conflict('Você não pode desativar o seu próprio usuário.');
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u || u.role === 'SELLER') throw notFound('Usuário');
    await prisma.user.update({ where: { id }, data: { active } });
    if (!active) await destroyUserSessions(id);
    await audit(prisma, actor(req), active ? 'ADMIN_ACTIVATED' : 'ADMIN_BLOCKED', 'user', id);
    return { ok: true };
  });
}
