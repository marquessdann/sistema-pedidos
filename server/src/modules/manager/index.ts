import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ClientStatus } from '@prisma/client';
import { z } from 'zod';
import { CLIENT_STATUSES, ORDER_STATUSES, normalizeCnpj } from '@della/shared';
import { prisma } from '../../db';
import { actor, managerCan, requireManager } from '../../lib/auth';
import { audit } from '../../lib/audit';
import { forbidden, notFound, unprocessable } from '../../lib/errors';
import { pageArgs, paged, paginationSchema } from '../../lib/validation';
import { decideApproval } from '../commercial/approvalService';
import { listSelectClient, orderFilterSchema, orderOrderBy, orderWhere, quoteFilterSchema, quoteOrderBy, quoteWhere } from '../commercial/filters';
import { allowedTransitions, changeOrderStatus, setOrderProgress } from '../commercial/orderService';
import { expireQuotes } from '../commercial/quoteService';
import { orderDetailInclude, quoteDetailInclude, serializeDoc } from '../commercial/serializers';
import { dashboardData, sendCommissions } from '../admin/reports';
import { clientSchema, validateClient } from '../admin/clients';
import { pendingClients, reviewClient } from '../commercial/clientReview';
import { conflict } from '../../lib/errors';

/**
 * Rotas do GESTOR (/api/manager/*), ex.: Vinicius.
 * - Enxerga somente os vendedores que supervisiona (definidos pelo administrador).
 * - Cada ação exige a permissão correspondente, marcada pelo administrador.
 * - Nunca recebe custo, margem ou tributos internos.
 */
const idParam = z.object({ id: z.string().uuid() });

function repIds(req: FastifyRequest) {
  return req.manager!.repIds;
}

function scopedRep(req: FastifyRequest, salesRepId?: string) {
  if (salesRepId && !repIds(req).includes(salesRepId)) throw forbidden('Vendedor fora da sua supervisão.');
  return salesRepId ? { salesRepId } : { salesRepId: { in: repIds(req) } };
}

export async function managerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireManager);

  // ---------------- Vendedores supervisionados ----------------
  app.get('/reps', async (req) => {
    const reps = await prisma.salesRep.findMany({
      where: { id: { in: repIds(req) }, deletedAt: null },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, title: true, commissionBps: true, maxDiscountBps: true, phone: true, user: { select: { active: true } } },
    });
    return reps.map(({ user, ...r }) => ({ ...r, active: user.active }));
  });

  // ---------------- Painel e vendas ----------------
  app.get('/dashboard', { preHandler: managerCan('canViewSales') }, async (req) => dashboardData(req.query, repIds(req)));

  app.get('/orders', { preHandler: managerCan('canViewSales') }, async (req) => {
    const f = orderFilterSchema.parse(req.query);
    const where = { AND: [orderWhere({ ...f, salesRepId: undefined }), scopedRep(req, f.salesRepId)] };
    const [items, total, sum] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: orderOrderBy(f.sort),
        include: { client: listSelectClient, salesRep: { select: { id: true, fullName: true } }, _count: { select: { items: true } } },
        ...pageArgs(f),
      }),
      prisma.order.count({ where }),
      prisma.order.aggregate({ where, _sum: { totalCents: true, grossCents: true } }),
    ]);
    return { ...paged(items.map((o) => serializeDoc(o, false)), total, f), sums: { totalCents: sum._sum.totalCents ?? 0, grossCents: sum._sum.grossCents ?? 0 } };
  });

  app.get('/orders/:id', { preHandler: managerCan('canViewSales') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await prisma.order.findFirst({ where: { id, ...scopedRep(req) }, include: orderDetailInclude });
    if (!o) throw notFound('Pedido');
    const transitions = o.status !== 'DRAFT' && req.manager!.perms.canUpdateOrderStatus ? await allowedTransitions(prisma, o.status) : [];
    return { ...serializeDoc(o, false), allowedTransitions: transitions, audit: [] };
  });

  app.post('/orders/:id/status', { preHandler: managerCan('canUpdateOrderStatus') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(1000).nullish() }).parse(req.body);
    const o = await prisma.order.findFirst({ where: { id, ...scopedRep(req) }, select: { id: true } });
    if (!o) throw notFound('Pedido');
    return changeOrderStatus({ ...actor(req), userId: req.user!.id }, id, b.status, b.note ?? null);
  });

  app.post('/orders/:id/progress', { preHandler: managerCan('canUpdateOrderStatus') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ step: z.enum(['APPROVED', 'INVOICED', 'AWAITING_PICKING', 'LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT', 'OUT_FOR_DELIVERY', 'DELIVERED']), on: z.boolean() }).parse(req.body);
    const o = await prisma.order.findFirst({ where: { id, ...scopedRep(req) }, select: { id: true } });
    if (!o) throw notFound('Pedido');
    return setOrderProgress({ ...actor(req), userId: req.user!.id }, id, b.step, b.on);
  });

  app.get('/quotes', { preHandler: managerCan('canViewSales') }, async (req) => {
    await expireQuotes();
    const f = quoteFilterSchema.parse(req.query);
    const where = { AND: [quoteWhere({ ...f, salesRepId: undefined }), scopedRep(req, f.salesRepId)] };
    const [items, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        orderBy: quoteOrderBy(f.sort),
        include: { client: listSelectClient, salesRep: { select: { id: true, fullName: true } }, convertedOrder: { select: { id: true, number: true } }, _count: { select: { items: true } } },
        ...pageArgs(f),
      }),
      prisma.quote.count({ where }),
    ]);
    return paged(items.map((q) => serializeDoc(q, false)), total, f);
  });

  app.get('/quotes/:id', { preHandler: managerCan('canViewSales') }, async (req) => {
    const { id } = idParam.parse(req.params);
    await expireQuotes();
    const q = await prisma.quote.findFirst({ where: { id, ...scopedRep(req) }, include: { ...quoteDetailInclude, orders: { select: { id: true, number: true, status: true, createdAt: true } } } });
    if (!q) throw notFound('Orçamento');
    return { ...serializeDoc(q, false), audit: [] };
  });

  // ---------------- Comissões ----------------
  app.get('/commissions', { preHandler: managerCan('canViewCommissions') }, async (req, reply) => sendCommissions(req.query, reply, repIds(req)));

  // ---------------- Aprovações de desconto ----------------
  app.get('/approvals', { preHandler: managerCan('canApproveDiscounts') }, async (req) => {
    const q = paginationSchema.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }).parse(req.query);
    const where = { ...(q.status ? { status: q.status } : {}), ...scopedRep(req) };
    const docSel = { select: { id: true, number: true, totalCents: true, grossCents: true, status: true, client: listSelectClient } };
    const [items, total] = await Promise.all([
      prisma.discountApproval.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { salesRep: { select: { fullName: true } }, decidedBy: { select: { name: true } }, order: docSel, quote: docSel },
        ...pageArgs(q),
      }),
      prisma.discountApproval.count({ where }),
    ]);
    return paged(items, total, q);
  });

  app.post('/approvals/:id/decide', { preHandler: managerCan('canApproveDiscounts') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(1000).nullish() }).parse(req.body);
    const ap = await prisma.discountApproval.findFirst({ where: { id, ...scopedRep(req) }, select: { id: true } });
    if (!ap) throw notFound('Solicitação de aprovação');
    return decideApproval({ ...actor(req), userId: req.user!.id }, id, b.decision, b.note ?? null);
  });

  // ---------------- Liberação de produtos ----------------
  app.get('/brands', async () => prisma.brand.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, active: true } }));
  app.get('/categories', async () => prisma.category.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }));

  app.get('/products', { preHandler: managerCan('canReleaseProducts') }, async (req) => {
    const q = paginationSchema
      .extend({
        q: z.string().trim().max(100).optional(),
        brandId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        status: z.enum(['active', 'inactive', 'all']).default('all'),
      })
      .parse(req.query);
    const where = {
      deletedAt: null,
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.status === 'active' ? { active: true } : q.status === 'inactive' ? { active: false } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { sku: { contains: q.q, mode: 'insensitive' as const } }, { brand: { name: { contains: q.q, mode: 'insensitive' as const } } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        // seleção explícita: custo, tributo e margem não são enviados ao gestor
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
          unitsPerBox: true,
          priceCents: true,
          stockQty: true,
          active: true,
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { fileName: true } },
        },
        ...pageArgs(q),
      }),
      prisma.product.count({ where }),
    ]);
    return paged(items, total, q);
  });

  app.post('/products/:id/active', { preHandler: managerCan('canReleaseProducts') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const p = await prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw notFound('Produto');
    if (active && p.priceCents <= 0) throw unprocessable('Este produto ainda não tem preço de venda. Peça ao administrador para preenchê-lo.', 'PRICE_REQUIRED');
    await prisma.product.update({ where: { id }, data: { active, updatedById: req.user!.id } });
    await audit(prisma, actor(req), active ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED', 'product', id, { sku: p.sku, by: 'gestor' });
    return { id, active };
  });

  // ---------------- Liberação de clientes ----------------
  app.get('/clients', async (req) => {
    const q = paginationSchema.extend({ q: z.string().trim().max(100).optional(), status: z.enum(CLIENT_STATUSES).optional() }).parse(req.query);
    const where = {
      deletedAt: null,
      salesRepId: { in: repIds(req) },
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { legalName: { contains: q.q, mode: 'insensitive' as const } },
              { tradeName: { contains: q.q, mode: 'insensitive' as const } },
              ...(normalizeCnpj(q.q).length >= 3 ? [{ cnpj: { contains: normalizeCnpj(q.q) } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { legalName: 'asc' },
        select: { id: true, legalName: true, tradeName: true, cnpj: true, city: true, state: true, commercialPhone: true, status: true, createdAt: true, availableToAllReps: true, salesRep: { select: { id: true, fullName: true } } },
        ...pageArgs(q),
      }),
      prisma.client.count({ where }),
    ]);
    return paged(items, total, q);
  });

  // Cadastro de clientes pelo gestor (somente para os vendedores que acompanha)
  app.get('/clients/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const c = await prisma.client.findFirst({ where: { id, deletedAt: null, salesRepId: { in: repIds(req) } }, include: { salesRep: { select: { id: true, fullName: true } } } });
    if (!c) throw notFound('Cliente');
    const stats = await prisma.order.aggregate({ where: { clientId: id, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] } }, _count: true, _sum: { totalCents: true }, _max: { orderDate: true } });
    return { ...c, stats: { orders: stats._count, totalCents: stats._sum.totalCents ?? 0, lastOrderDate: stats._max.orderDate?.toISOString().slice(0, 10) ?? null } };
  });

  app.post('/clients/check-duplicate', async (req) => {
    const b = z.object({ cnpj: z.string().optional(), excludeId: z.string().uuid().optional() }).parse(req.body);
    const cnpj = normalizeCnpj(b.cnpj);
    const dup = cnpj.length === 14 ? await prisma.client.findFirst({ where: { cnpj, ...(b.excludeId ? { id: { not: b.excludeId } } : {}) }, select: { id: true, legalName: true, salesRepId: true } }) : null;
    // dados de clientes de outros vendedores não são expostos ao gestor
    const visible = dup && dup.salesRepId && repIds(req).includes(dup.salesRepId);
    return { cnpjDuplicate: dup ? (visible ? { id: dup.id, legalName: dup.legalName, cnpj } : { id: null, legalName: 'cliente já cadastrado (outro vendedor)', cnpj }) : null, similarNames: [] };
  });

  const managerClient = (req: FastifyRequest) => {
    const data = clientSchema.parse(req.body);
    if (!data.salesRepId || !repIds(req).includes(data.salesRepId)) throw forbidden('Escolha um dos vendedores que você acompanha.');
    // sem permissão de liberar, o cadastro do gestor também entra em análise
    if (!req.manager!.perms.canReleaseClients) data.status = 'UNDER_REVIEW';
    return { ...data, availableToAllReps: false };
  };

  app.post('/clients', async (req, reply) => {
    const data = managerClient(req);
    if (await prisma.client.findUnique({ where: { cnpj: data.cnpj }, select: { id: true } })) throw conflict('Este CNPJ já está cadastrado no sistema.', 'DUPLICATE_CNPJ');
    await validateClient(data);
    const c = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({ data: { ...data, createdById: req.user!.id, updatedById: req.user!.id } });
      await audit(tx, actor(req), 'CLIENT_CREATED', 'client', created.id, { ...data, by: 'gestor' });
      return created;
    });
    return reply.status(201).send(c);
  });

  app.put('/clients/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = managerClient(req);
    const before = await prisma.client.findFirst({ where: { id, deletedAt: null, salesRepId: { in: repIds(req) } } });
    if (!before) throw notFound('Cliente');
    if (!req.manager!.perms.canReleaseClients) data.status = before.status;
    await validateClient(data, id);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.client.update({ where: { id }, data: { ...data, updatedById: req.user!.id } });
      await audit(tx, actor(req), before.status !== data.status ? 'CLIENT_STATUS_CHANGED' : 'CLIENT_UPDATED', 'client', id, { by: 'gestor' });
      return updated;
    });
  });

  // Pendência cadastral (clientes enviados pelos vendedores que acompanha)
  app.get('/clients-pending', { preHandler: managerCan('canReleaseClients') }, async (req) => {
    const items = await pendingClients(repIds(req));
    return { items, total: items.length };
  });

  app.post('/clients/:id/review', { preHandler: managerCan('canReleaseClients') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ decision: z.enum(['APPROVE', 'RETURN', 'REJECT']), note: z.string().trim().max(1000).nullish() }).parse(req.body);
    return reviewClient({ ...actor(req), userId: req.user!.id }, id, b.decision, b.note ?? null, repIds(req));
  });

  app.post('/clients/:id/status', { preHandler: managerCan('canReleaseClients') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(CLIENT_STATUSES) }).parse(req.body);
    const c = await prisma.client.findFirst({ where: { id, deletedAt: null, salesRepId: { in: repIds(req) } } });
    if (!c) throw notFound('Cliente');
    if (c.status === status) throw unprocessable('O cliente já está neste status.');
    await prisma.client.update({ where: { id }, data: { status: status as ClientStatus, updatedById: req.user!.id } });
    await audit(prisma, actor(req), 'CLIENT_STATUS_CHANGED', 'client', id, { status: { from: c.status, to: status }, by: 'gestor' });
    return { id, status };
  });
}
