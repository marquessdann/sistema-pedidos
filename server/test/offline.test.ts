import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { type Fixtures, key, loginAdmin, loginVictor, makeApp, prisma, seedBase } from './helpers';

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

describe('Modo sem internet (vendedor)', () => {
  it('pacote de sincronização traz catálogo, clientes e condições — sem custo e só os clientes do vendedor', async () => {
    const v = await loginVictor(app);
    const r = await v.get('/api/seller/offline-snapshot');
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.config.maxDiscountBps).toBe(500);
    expect(b.config.paymentTerms.map((t: any) => t.id)).toContain(fx.termId);
    expect(b.brands.length).toBe(2);
    const ids = b.products.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining([fx.p1, fx.p2, fx.p3]));
    expect(ids).not.toContain(fx.inactiveProduct);
    const raw = JSON.stringify(b);
    expect(raw).not.toContain('costCents');
    expect(raw).not.toContain('taxRefBps');
    const clientIds = b.clients.map((c: any) => c.id);
    expect(clientIds).toEqual(expect.arrayContaining([fx.clientVictor, fx.clientPending]));
    expect(clientIds).not.toContain(fx.clientAna);
    const pending = b.clients.find((c: any) => c.id === fx.clientPending);
    expect(pending).toMatchObject({ selectable: true, canOrder: false, pendingApproval: true });
  });

  it('administrador não acessa o pacote do vendedor', async () => {
    const a = await loginAdmin(app);
    expect((await a.get('/api/seller/offline-snapshot')).status).toBe(403);
  });

  it('sessão do vendedor dura 30 dias (administrador continua com sessão curta)', async () => {
    const v = await loginVictor(app);
    const a = await loginAdmin(app);
    const sessions = await prisma.session.findMany({ include: { user: { select: { role: true } } } });
    const days = (d: Date) => (d.getTime() - Date.now()) / 86_400_000;
    const seller = sessions.filter((s) => s.user.role === 'SELLER');
    const admin = sessions.filter((s) => s.user.role === 'ADMIN');
    expect(seller.length).toBeGreaterThan(0);
    for (const s of seller) expect(days(s.expiresAt)).toBeGreaterThan(29);
    for (const s of admin) expect(days(s.expiresAt)).toBeLessThan(1);
    expect(v.cookie).toBeTruthy();
    expect(a.cookie).toBeTruthy();
  });

  it('sessão do vendedor é renovada com o uso', async () => {
    const v = await loginVictor(app);
    // simula sessão antiga, perto de expirar
    const old = new Date(Date.now() - 10 * 60_000);
    const soon = new Date(Date.now() + 2 * 86_400_000);
    await prisma.session.updateMany({ where: { user: { role: 'SELLER' } }, data: { lastSeenAt: old, expiresAt: soon } });
    const r = await v.get('/api/seller/config');
    expect(r.status).toBe(200);
    expect(String(r.headers['set-cookie'] ?? '')).toContain('della_sid=');
    const s = await prisma.session.findFirst({ where: { user: { role: 'SELLER' } }, orderBy: { lastSeenAt: 'desc' } });
    expect((s!.expiresAt.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29);
  });

  it('pedido feito sem internet e reenviado várias vezes na sincronização não duplica', async () => {
    const v = await loginVictor(app);
    const body = {
      idempotencyKey: key('off'),
      clientId: fx.clientVictor,
      items: [{ productId: fx.p1, quantity: 2, discountBps: 0, saleUnit: 'UN' }],
      action: 'CONFIRM',
    };
    const a = await v.post('/api/seller/orders', body);
    const b = await v.post('/api/seller/orders', body);
    expect(a.status).toBe(201);
    expect(b.body.order.id).toBe(a.body.order.id);
    expect(await prisma.order.count()).toBe(1);
  });
});
