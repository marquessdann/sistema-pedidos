import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Agent, key, loginAdmin, loginVictor, makeApp, prisma, seedBase, type Fixtures } from './helpers';
import { hashPassword } from '../src/lib/password';

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

async function confirmedOrder() {
  const v = await loginVictor(app);
  const r = await v.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 2 }], notes: 'Entregar pela manhã' });
  expect(r.status).toBe(201);
  return { v, order: r.body.order };
}

async function loginAntonio() {
  const a = await loginAdmin(app);
  const c = await a.post('/api/admin/users', { username: 'antonio', name: 'Antonio', password: 'Logistica2026', role: 'LOGISTICS' });
  expect(c.status).toBe(201);
  const l = new Agent(app);
  expect((await l.login('antonio', 'Logistica2026')).status).toBe(200);
  const pw = await l.post('/api/auth/change-password', { currentPassword: 'Logistica2026', newPassword: 'Separacao2027' });
  expect(pw.status).toBe(200);
  return l;
}

describe('Ciclo do pedido com chavinhas', () => {
  it('administrador: aprovado → faturado → enviado para a logística; o vendedor vê o status', async () => {
    const { v, order } = await confirmedOrder();
    const a = await loginAdmin(app);
    let r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'APPROVED', on: true });
    expect(r.body.status).toBe('APPROVED');
    r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'AWAITING_PICKING', on: true }); // pula o faturado: marca junto
    expect(r.body.status).toBe('AWAITING_PICKING');
    expect((await v.get(`/api/seller/orders/${order.id}`)).body.status).toBe('AWAITING_PICKING');
    const hist = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(hist.map((h) => h.toStatus)).toEqual(['CREATED', 'APPROVED', 'INVOICED', 'AWAITING_PICKING']);
    expect(hist.at(-1)!.note).toBe('Marcado: Enviado para a logística');
  });

  it('desligar volta para a etapa anterior', async () => {
    const { order } = await confirmedOrder();
    const a = await loginAdmin(app);
    await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'INVOICED', on: true });
    let r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'INVOICED', on: false });
    expect(r.body.status).toBe('APPROVED');
    r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'APPROVED', on: false });
    expect(r.body.status).toBe('CREATED');
    const last = await prisma.orderStatusHistory.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
    expect(last!.note).toBe('Desmarcado: Aprovado');
  });

  it('logística (Antonio): só vê pedidos enviados para a logística, sem valores, e marca só as etapas dela', async () => {
    const { v, order } = await confirmedOrder();
    const a = await loginAdmin(app);
    const l = await loginAntonio();

    // antes de ir para a logística: não aparece e não pode mexer
    expect((await l.get('/api/logistics/orders')).body.items).toHaveLength(0);
    expect((await l.post(`/api/logistics/orders/${order.id}/progress`, { step: 'LOGISTICS_RECEIVED', on: true })).status).toBe(404);

    await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'AWAITING_PICKING', on: true });
    const list = await l.get('/api/logistics/orders');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.counts.newOnes).toBe(1);
    const raw = JSON.stringify(list.body);
    expect(raw).not.toMatch(/Cents|price|discount|margin|commission/i);
    expect(list.body.items[0].items[0]).toMatchObject({ sku: 'A-001', quantity: 2 });
    expect(list.body.items[0].notes).toBe('Entregar pela manhã');

    for (const step of ['LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT', 'OUT_FOR_DELIVERY']) {
      const r = await l.post(`/api/logistics/orders/${order.id}/progress`, { step, on: true });
      expect(r.status, step).toBe(200);
    }
    expect((await v.get(`/api/seller/orders/${order.id}`)).body.status).toBe('OUT_FOR_DELIVERY');
    expect((await l.get('/api/logistics/orders?tab=route')).body.items).toHaveLength(1);
    expect((await l.post(`/api/logistics/orders/${order.id}/progress`, { step: 'DELIVERED', on: true })).body.status).toBe('DELIVERED');

    // etapas do escritório e áreas restritas: bloqueadas
    expect((await l.post(`/api/logistics/orders/${order.id}/progress`, { step: 'INVOICED', on: false })).status).toBe(400);
    expect((await l.post(`/api/admin/orders/${order.id}/progress`, { step: 'INVOICED', on: false })).status).toBe(403);
    expect((await l.get('/api/admin/orders')).status).toBe(403);
    expect((await l.get('/api/seller/catalog')).status).toBe(403);
    expect((await l.get(`/api/documents/orders/${order.id}`)).status).toBe(403);

    const hist = await prisma.orderStatusHistory.findFirst({ where: { orderId: order.id, toStatus: 'DELIVERED' }, include: { user: true } });
    expect(hist!.user.name).toBe('Antonio');
  });

  it('logística baixa o PDF de separação (sem valores)', async () => {
    const { order } = await confirmedOrder();
    const a = await loginAdmin(app);
    const l = await loginAntonio();
    await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'AWAITING_PICKING', on: true });
    const r = await l.get(`/api/logistics/orders/${order.id}/picking.pdf`);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('application/pdf');
    expect(r.raw.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('logística não desmarca abaixo de "Enviado para a logística"', async () => {
    const { order } = await confirmedOrder();
    const a = await loginAdmin(app);
    const l = await loginAntonio();
    await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'AWAITING_PICKING', on: true });
    await l.post(`/api/logistics/orders/${order.id}/progress`, { step: 'LOGISTICS_RECEIVED', on: true });
    const r = await l.post(`/api/logistics/orders/${order.id}/progress`, { step: 'LOGISTICS_RECEIVED', on: false });
    expect(r.body.status).toBe('AWAITING_PICKING');
  });

  it('gestor com permissão usa as chavinhas; vendedor não', async () => {
    const { v, order } = await confirmedOrder();
    await prisma.user.create({
      data: {
        username: 'vinicius',
        name: 'Vinicius',
        role: 'MANAGER',
        passwordHash: await hashPassword('123456'),
        managerProfile: { create: { canUpdateOrderStatus: true, reps: { create: [{ salesRepId: fx.victorRepId }] } } },
      },
    });
    const m = new Agent(app);
    expect((await m.login('vinicius', '123456')).status).toBe(200);
    const r = await m.post(`/api/manager/orders/${order.id}/progress`, { step: 'INVOICED', on: true });
    expect(r.body.status).toBe('INVOICED');
    expect((await v.post(`/api/admin/orders/${order.id}/progress`, { step: 'DELIVERED', on: true })).status).toBe(403);
  });

  it('pedido cancelado não tem andamento', async () => {
    const { order } = await confirmedOrder();
    const a = await loginAdmin(app);
    await a.post(`/api/admin/orders/${order.id}/status`, { status: 'CANCELLED', note: 'teste de cancelamento' });
    expect((await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'APPROVED', on: true })).status).toBe(422);
  });
});
