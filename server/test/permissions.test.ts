import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { key, loginAdmin, loginAna, loginVictor, makeApp, prisma, seedBase, type Fixtures } from './helpers';

let app: FastifyInstance;
let fx: Fixtures;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  fx = await seedBase();
});

describe('Permissões entre vendedores', () => {
  it('vendedor só vê os próprios clientes, pedidos e orçamentos', async () => {
    const victor = await loginVictor(app);
    const ana = await loginAna(app);
    const o = (await victor.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 1 }] })).body.order;
    const q = (await victor.post('/api/seller/quotes', { idempotencyKey: key(), clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 1 }] })).body.quote;

    expect((await ana.get('/api/seller/clients')).body.items.map((c: any) => c.legalName)).toEqual(['Cliente da Ana Ltda']);
    expect((await ana.get(`/api/seller/clients/${fx.clientVictor}`)).status).toBe(404);
    expect((await ana.get('/api/seller/orders')).body.total).toBe(0);
    expect((await ana.get(`/api/seller/orders/${o.id}`)).status).toBe(404);
    expect((await ana.get(`/api/seller/orders/${o.id}/history`)).status).toBe(404);
    expect((await ana.get(`/api/seller/quotes/${q.id}`)).status).toBe(404);
    expect((await ana.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key() })).status).toBe(404);
    expect((await ana.post(`/api/seller/orders/${o.id}/duplicate`, { idempotencyKey: key() })).status).toBe(404);
    // tentar reaproveitar a chave de outro vendedor não expõe nem altera o pedido
    const reuse = await ana.post('/api/seller/orders', { idempotencyKey: (await prisma.order.findFirstOrThrow()).idempotencyKey, action: 'CONFIRM', clientId: fx.clientAna, items: [{ productId: fx.p1, quantity: 1 }] });
    expect(reuse.status).toBe(409);
  });

  it('com autorização expressa, vendedor consulta pedidos de outros (somente leitura)', async () => {
    const victor = await loginVictor(app);
    const o = (await victor.post('/api/seller/orders', { idempotencyKey: key(), action: 'DRAFT', clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 1 }] })).body.order;
    await prisma.salesRep.update({ where: { id: fx.anaRepId }, data: { canViewAllOrders: true } });
    const ana = await loginAna(app);
    const got = await ana.get(`/api/seller/orders/${o.id}`);
    expect(got.status).toBe(200);
    expect(got.body.readOnly).toBe(true);
    const edit = await ana.put(`/api/seller/orders/${o.id}`, { idempotencyKey: key(), action: 'CONFIRM', clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 9 }] });
    expect(edit.status).toBe(404);
  });

  it('e-mail financeiro só aparece com permissão; custo só com permissão expressa', async () => {
    const victor = await loginVictor(app);
    expect((await victor.get(`/api/seller/clients/${fx.clientVictor}`)).body.financeEmail).toBeUndefined();
    await prisma.salesRep.update({ where: { id: fx.victorRepId }, data: { canViewFinanceContact: true, canViewCost: true } });
    expect((await victor.get(`/api/seller/clients/${fx.clientVictor}`)).body.financeEmail).toBe('fin@cliente.test');
    const cat = await victor.get('/api/seller/catalog?q=A-001');
    expect(cat.body.brands[0].products[0].costCents).toBe(6000);
  });

  it('vendedor não lê nem altera o log de auditoria', async () => {
    const victor = await loginVictor(app);
    expect((await victor.get('/api/admin/audit')).status).toBe(403);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
  });
});

describe('Relatórios e dashboard', () => {
  it('relatórios diferenciam pedidos, faturamento e orçamentos; exporta CSV', async () => {
    const victor = await loginVictor(app);
    const admin = await loginAdmin(app);
    const o1 = (await victor.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 2 }], generalDiscountBps: 500 })).body.order;
    await victor.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId: fx.clientVictor, items: [{ productId: fx.p3, quantity: 1 }] });
    await victor.post('/api/seller/quotes', { idempotencyKey: key(), clientId: fx.clientVictor, items: [{ productId: fx.p3, quantity: 5 }] });
    for (const s of ['APPROVED', 'INVOICED', 'AWAITING_PICKING', 'LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT', 'SHIPPED']) await admin.post(`/api/admin/orders/${o1.id}/status`, { status: s });

    const sum = await admin.get('/api/admin/reports/summary');
    const created = sum.body.rows.find((r: any) => r.group.startsWith('Pedidos criados'));
    const fulfilled = sum.body.rows.find((r: any) => r.group.startsWith('Faturamento'));
    const quotes = sum.body.rows.find((r: any) => r.group.startsWith('Orçamentos'));
    expect(created.orders).toBe(2);
    expect(created.total).toBe(19_000 + 100_000);
    expect(fulfilled.total).toBe(19_000);
    expect(quotes.total).toBe(500_000);

    const byRep = await admin.get('/api/admin/reports/by-rep');
    expect(byRep.body.rows[0]).toMatchObject({ rep: 'Victor Badur', orders: 2, fulfilled: 19_000 });
    const top = await admin.get('/api/admin/reports/top-products');
    expect(top.body.rows.map((r: any) => r.sku)).toEqual(['A-001', 'B-004']);
    const disc = await admin.get('/api/admin/reports/discounts');
    expect(disc.body.rows).toHaveLength(1);
    const conv = await admin.get('/api/admin/reports/quote-conversion');
    expect(conv.body.rows[0]).toMatchObject({ quotes: 1, converted: 0, rate: 0 });

    const csv = await admin.get('/api/admin/reports/orders?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain('Pedido;Data;Cliente');
    expect(csv.body).toContain('190,00');

    for (const k of ['summary', 'orders', 'by-rep', 'by-client', 'top-products', 'quotes', 'quote-conversion', 'discounts', 'pending', 'cancelled']) {
      const pdf = await admin.get(`/api/admin/reports/${k}?format=pdf&salesRepId=${fx.victorRepId}`);
      expect(pdf.status, k).toBe(200);
      expect(String(pdf.headers['content-type'])).toContain('application/pdf');
      expect(pdf.raw.subarray(0, 4).toString()).toBe('%PDF');
    }

    const dash = await admin.get('/api/admin/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.kpis.ordersToday).toBe(2);
    expect(dash.body.kpis.shipped).toBe(1);
    expect(dash.body.kpis.openQuotes).toBe(1);
    expect(dash.body.kpis.clientsPending).toBe(1);
    expect(dash.body.kpis.discountCents).toBe(1_000);
  });
});
