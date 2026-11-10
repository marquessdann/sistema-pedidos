import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { key, loginVictor, makeApp, prisma, seedBase, type Fixtures } from './helpers';

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
  // p1: caixa com 12, só por caixa, 24 unidades (2 caixas)
  await prisma.product.update({ where: { id: fx.p1 }, data: { unitsPerBox: 12, boxOnly: true, stockQty: 24 } });
  await prisma.companySettings.update({ where: { id: 1 }, data: { stockEnabled: true, stockPolicy: 'ON_CONFIRM', blockOnInsufficientStock: true } });
});

const order = (items: unknown[]) => ({ idempotencyKey: key(), action: 'CONFIRM', clientId: fx.clientVictor, items });

describe('Venda só por caixa e estoque bloqueado', () => {
  it('produto só por caixa recusa venda por unidade e o catálogo informa', async () => {
    const v = await loginVictor(app);
    const r = await v.post('/api/seller/orders', order([{ productId: fx.p1, quantity: 1, saleUnit: 'UN' }]));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('BOX_ONLY');
    const cat = await v.get('/api/seller/catalog');
    const p = cat.body.brands.flatMap((b: any) => b.products).find((x: any) => x.id === fx.p1);
    expect(p).toMatchObject({ boxOnly: true, unitsPerBox: 12, availableQty: 24 });
  });

  it('confirmação reserva o estoque; o pedido seguinte sem saldo é bloqueado', async () => {
    const v = await loginVictor(app);
    const a = await v.post('/api/seller/orders', order([{ productId: fx.p1, quantity: 2, saleUnit: 'CX' }]));
    expect(a.status).toBe(201);
    const p = await prisma.product.findUniqueOrThrow({ where: { id: fx.p1 } });
    expect(p.reservedQty).toBe(24);
    const b = await v.post('/api/seller/orders', order([{ productId: fx.p1, quantity: 1, saleUnit: 'CX' }]));
    expect(b.status).toBe(422);
    expect(b.body.error).toBe('INSUFFICIENT_STOCK');
    // cancelar libera a reserva
    const admin = await (await import('./helpers')).loginAdmin(app);
    await admin.post(`/api/admin/orders/${a.body.order.id}/status`, { status: 'CANCELLED', note: 'teste' });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.p1 } })).reservedQty).toBe(0);
    expect((await v.post('/api/seller/orders', order([{ productId: fx.p1, quantity: 1, saleUnit: 'CX' }]))).status).toBe(201);
  });

  it('produto sem estoque não é vendido', async () => {
    const v = await loginVictor(app);
    const r = await v.post('/api/seller/orders', order([{ productId: fx.p2, quantity: 51 }]));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('INSUFFICIENT_STOCK');
  });
});
