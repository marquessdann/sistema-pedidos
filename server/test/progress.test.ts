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
  const r = await v.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 1 }] });
  expect(r.status).toBe(201);
  return { v, order: r.body.order };
}

describe('Chavinhas de andamento do pedido', () => {
  it('ligar avança até a etapa (passando pelas intermediárias) e o vendedor vê o novo status', async () => {
    const { v, order } = await confirmedOrder();
    const a = await loginAdmin(app);

    let r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'PICKING', on: true });
    expect(r.status).toBe(200);
    expect((await v.get(`/api/seller/orders/${order.id}`)).body.status).toBe('PICKING');

    r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'DELIVERED', on: true });
    expect(r.status).toBe(200);
    const seen = await v.get(`/api/seller/orders/${order.id}`);
    expect(seen.body.status).toBe('DELIVERED');
    const hist = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(hist.at(-1)!.note).toBe('Marcado: Entregue');

    // ligar de novo uma etapa já cumprida não muda nada
    r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'INVOICED', on: true });
    expect(r.body.status).toBe('DELIVERED');
  });

  it('desligar volta para a etapa anterior', async () => {
    const { order } = await confirmedOrder();
    const a = await loginAdmin(app);
    await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'INVOICED', on: true });
    let r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'INVOICED', on: false });
    expect(r.body.status).toBe('PICKING');
    r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'PICKING', on: false });
    expect(r.body.status).toBe('APPROVED');
    const last = await prisma.orderStatusHistory.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
    expect(last!.note).toBe('Desmarcado: Em separação');
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
    const r = await m.post(`/api/manager/orders/${order.id}/progress`, { step: 'OUT_FOR_DELIVERY', on: true });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('OUT_FOR_DELIVERY');
    expect((await v.post(`/api/admin/orders/${order.id}/progress`, { step: 'DELIVERED', on: true })).status).toBe(403);
  });

  it('pedido cancelado não tem andamento', async () => {
    const { order } = await confirmedOrder();
    const a = await loginAdmin(app);
    await a.post(`/api/admin/orders/${order.id}/status`, { status: 'CANCELLED', note: 'teste de cancelamento' });
    const r = await a.post(`/api/admin/orders/${order.id}/progress`, { step: 'PICKING', on: true });
    expect(r.status).toBe(422);
  });
});
