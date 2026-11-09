import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ORDER_LOGISTICS_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@della/shared';
import { prisma } from '../../db';
import { actor, requireLogistics } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import { getSettings } from '../../lib/settings';
import { getFile } from '../../lib/storage';
import { fromDbDate } from '../../lib/validation';
import { DEFAULT_LOGO_PNG } from '../../assets/defaultLogo';
import { addressLine } from '../documents/pdf';
import { setOrderProgress } from '../commercial/orderService';
import { renderPickingPdf } from './pickingPdf';

const idParam = z.object({ id: z.string().uuid() });
const LOGISTICS_VISIBLE: OrderStatus[] = [...ORDER_LOGISTICS_STATUSES, 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'];

/** Somente o necessário para separar e entregar: nada de preços, custos, descontos ou comissões. */
const select = {
  id: true,
  number: true,
  status: true,
  orderDate: true,
  expectedDelivery: true,
  notes: true,
  updatedAt: true,
  salesRep: { select: { fullName: true } },
  client: {
    select: {
      legalName: true,
      tradeName: true,
      responsibleName: true,
      commercialPhone: true,
      street: true,
      number: true,
      complement: true,
      district: true,
      city: true,
      state: true,
      cep: true,
    },
  },
  items: {
    orderBy: { position: 'asc' as const },
    select: { sku: true, productName: true, brandName: true, quantity: true, saleUnit: true, unitsPerSaleUnit: true, unit: true, imageFileName: true },
  },
  statusHistory: { orderBy: { createdAt: 'asc' as const }, select: { fromStatus: true, toStatus: true, note: true, createdAt: true, user: { select: { name: true } } } },
};

function view(o: any) {
  const c = o.client;
  return {
    ...o,
    orderDate: fromDbDate(o.orderDate),
    expectedDelivery: fromDbDate(o.expectedDelivery),
    statusLabel: ORDER_STATUS_LABELS[o.status as OrderStatus],
    client: { name: c.legalName, tradeName: c.tradeName, responsible: c.responsibleName, phone: c.commercialPhone, address: addressLine(c) },
  };
}

/** Rotas /api/logistics/*: perfil da logística (ex.: Antonio). */
export async function logisticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireLogistics);

  app.get('/orders', async (req) => {
    const { tab } = z.object({ tab: z.enum(['todo', 'route', 'done']).default('todo') }).parse(req.query);
    const statuses: OrderStatus[] = tab === 'todo' ? ORDER_LOGISTICS_STATUSES : tab === 'route' ? ['SHIPPED', 'OUT_FOR_DELIVERY'] : ['DELIVERED', 'COMPLETED'];
    const since = new Date(Date.now() - 45 * 86_400_000);
    const [orders, counts] = await Promise.all([
      prisma.order.findMany({
        where: { status: { in: statuses }, ...(tab === 'done' ? { updatedAt: { gte: since } } : {}) },
        orderBy: tab === 'done' ? { updatedAt: 'desc' } : { orderDate: 'asc' },
        take: 200,
        select,
      }),
      prisma.order.groupBy({ by: ['status'], where: { status: { in: [...ORDER_LOGISTICS_STATUSES, 'SHIPPED', 'OUT_FOR_DELIVERY'] } }, _count: true }),
    ]);
    const count = (list: string[]) => counts.filter((c) => list.includes(c.status)).reduce((a, c) => a + c._count, 0);
    return {
      items: orders.map(view),
      counts: { todo: count(ORDER_LOGISTICS_STATUSES), route: count(['SHIPPED', 'OUT_FOR_DELIVERY']), newOnes: count(['AWAITING_PICKING']) },
    };
  });

  app.get('/orders/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await prisma.order.findFirst({ where: { id, status: { in: LOGISTICS_VISIBLE } }, select });
    if (!o) throw notFound('Pedido');
    return view(o);
  });

  app.post('/orders/:id/progress', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ step: z.enum(['LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT', 'OUT_FOR_DELIVERY', 'DELIVERED']), on: z.boolean() }).parse(req.body);
    const o = await prisma.order.findFirst({ where: { id, status: { in: LOGISTICS_VISIBLE } }, select: { id: true } });
    if (!o) throw notFound('Pedido');
    return setOrderProgress({ ...actor(req), userId: req.user!.id }, id, b.step, b.on, { logistics: true });
  });

  /** PDF de separação (romaneio), gerado na hora e sem valores. */
  app.get('/orders/:id/picking.pdf', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const o = await prisma.order.findFirst({ where: { id, status: { in: LOGISTICS_VISIBLE } }, select });
    if (!o) throw notFound('Pedido');
    const v = view(o);
    const s = await getSettings();
    const logo = (s.logoFileName ? (await getFile('company', s.logoFileName).catch(() => null))?.data : null) ?? DEFAULT_LOGO_PNG;
    const pdf = await renderPickingPdf({
      number: v.number ?? '',
      statusLabel: v.statusLabel,
      orderDate: v.orderDate!,
      expectedDelivery: v.expectedDelivery,
      sellerName: v.salesRep.fullName,
      client: v.client,
      notes: v.notes,
      items: v.items.map((i: any) => ({ sku: i.sku, name: i.productName, brand: i.brandName, quantity: i.quantity, saleUnit: i.saleUnit, unitsPerSaleUnit: i.unitsPerSaleUnit, unit: i.unit })),
      logo: logo ? Buffer.from(logo) : null,
    });
    const download = (req.query as { download?: string }).download === '1';
    reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `${download ? 'attachment' : 'inline'}; filename="separacao-${v.number}.pdf"`);
    return reply.send(pdf);
  });
}
