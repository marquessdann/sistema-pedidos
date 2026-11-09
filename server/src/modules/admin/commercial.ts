import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ORDER_STATUSES } from '@della/shared';
import { prisma } from '../../db';
import { actor } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import { pageArgs, paged, paginationSchema } from '../../lib/validation';
import { decideApproval } from '../commercial/approvalService';
import { listSelectClient, orderFilterSchema, orderOrderBy, orderWhere, quoteFilterSchema, quoteOrderBy, quoteWhere } from '../commercial/filters';
import { allowedTransitions, changeOrderStatus, setOrderProgress } from '../commercial/orderService';
import { allowReconversion, expireQuotes } from '../commercial/quoteService';
import { orderDetailInclude, quoteDetailInclude, serializeDoc } from '../commercial/serializers';

const idParam = z.object({ id: z.string().uuid() });

export async function adminCommercialRoutes(app: FastifyInstance) {
  // ---------------- Pedidos ----------------
  app.get('/orders', async (req) => {
    const f = orderFilterSchema.parse(req.query);
    const where = orderWhere(f);
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
    return {
      ...paged(items.map((o) => serializeDoc(o, true)), total, f),
      sums: { totalCents: sum._sum.totalCents ?? 0, grossCents: sum._sum.grossCents ?? 0 },
    };
  });

  app.get('/orders/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await prisma.order.findUnique({ where: { id }, include: { ...orderDetailInclude, stockMovements: { orderBy: { createdAt: 'asc' }, include: { product: { select: { sku: true } } } } } });
    if (!o) throw notFound('Pedido');
    const audits = await prisma.auditLog.findMany({ where: { entity: 'order', entityId: id }, orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } });
    return { ...serializeDoc(o, true), allowedTransitions: o.status === 'DRAFT' ? [] : await allowedTransitions(prisma, o.status), audit: audits };
  });

  app.post('/orders/:id/status', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(1000).nullish() }).parse(req.body);
    return changeOrderStatus({ ...actor(req), userId: req.user!.id }, id, b.status, b.note ?? null);
  });

  /** Chavinhas de andamento (separação, faturado, em rota, entregue). */
  app.post('/orders/:id/progress', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ step: z.enum(['APPROVED', 'INVOICED', 'AWAITING_PICKING', 'LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT', 'OUT_FOR_DELIVERY', 'DELIVERED']), on: z.boolean() }).parse(req.body);
    return setOrderProgress({ ...actor(req), userId: req.user!.id }, id, b.step, b.on);
  });

  app.post('/orders/:id/reopen', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().min(10, 'Justificativa: mínimo de 10 caracteres.').max(1000) }).parse(req.body);
    return changeOrderStatus({ ...actor(req), userId: req.user!.id }, id, b.status, b.note, { reopen: true });
  });

  // ---------------- Orçamentos ----------------
  app.get('/quotes', async (req) => {
    await expireQuotes();
    const f = quoteFilterSchema.parse(req.query);
    const where = quoteWhere(f);
    const [items, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        orderBy: quoteOrderBy(f.sort),
        include: {
          client: listSelectClient,
          salesRep: { select: { id: true, fullName: true } },
          convertedOrder: { select: { id: true, number: true } },
          _count: { select: { items: true } },
        },
        ...pageArgs(f),
      }),
      prisma.quote.count({ where }),
    ]);
    return paged(items.map((q) => serializeDoc(q, true)), total, f);
  });

  app.get('/quotes/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    await expireQuotes();
    const q = await prisma.quote.findUnique({ where: { id }, include: { ...quoteDetailInclude, orders: { select: { id: true, number: true, status: true, createdAt: true } } } });
    if (!q) throw notFound('Orçamento');
    const audits = await prisma.auditLog.findMany({ where: { entity: 'quote', entityId: id }, orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } });
    return { ...serializeDoc(q, true), audit: audits };
  });

  app.post('/quotes/:id/allow-reconversion', async (req) => {
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(10, 'Justificativa: mínimo de 10 caracteres.').max(1000) }).parse(req.body);
    await allowReconversion({ ...actor(req), userId: req.user!.id }, id, reason);
    return { ok: true };
  });

  // ---------------- Aprovações de desconto ----------------
  app.get('/approvals', async (req) => {
    const q = paginationSchema.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }).parse(req.query);
    const where = q.status ? { status: q.status } : {};
    const [items, total] = await Promise.all([
      prisma.discountApproval.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          salesRep: { select: { fullName: true } },
          decidedBy: { select: { name: true } },
          order: { select: { id: true, number: true, totalCents: true, grossCents: true, marginCents: true, costCents: true, status: true, client: listSelectClient } },
          quote: { select: { id: true, number: true, totalCents: true, grossCents: true, marginCents: true, costCents: true, status: true, client: listSelectClient } },
        },
        ...pageArgs(q),
      }),
      prisma.discountApproval.count({ where }),
    ]);
    return paged(items, total, q);
  });

  app.post('/approvals/:id/decide', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(1000).nullish() }).parse(req.body);
    return decideApproval({ ...actor(req), userId: req.user!.id }, id, b.decision, b.note ?? null);
  });
}
