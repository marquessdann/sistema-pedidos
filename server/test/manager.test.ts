import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Agent, key, loginAdmin, loginAna, loginVictor, makeApp, prisma, seedBase, type Fixtures } from './helpers';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let fx: Fixtures;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

async function makeManager(perms: Record<string, boolean> = {}) {
  await prisma.user.create({
    data: {
      username: 'vinicius',
      name: 'Vinicius',
      role: 'MANAGER',
      passwordHash: await hashPassword('123456'),
      managerProfile: { create: { ...perms, reps: { create: [{ salesRepId: fx.victorRepId }] } } },
    },
  });
  const a = new Agent(app);
  const r = await a.login('Vinicius', '123456');
  expect(r.status).toBe(200);
  return a;
}

async function orderFor(agent: Agent, clientId: string, extra: Record<string, unknown> = {}) {
  const r = await agent.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId, items: [{ productId: fx.p3, quantity: 1 }], freightCents: 1_000, ...extra });
  return r.body.order;
}

beforeEach(async () => {
  fx = await seedBase();
});

describe('Gestor (ex.: Vinicius)', () => {
  it('entra como gestor e não acessa rotas administrativas nem de vendedor', async () => {
    const v = await makeManager();
    const me = await v.get('/api/auth/me');
    expect(me.body.user.role).toBe('MANAGER');
    expect(me.body.manager.repIds).toEqual([fx.victorRepId]);
    for (const url of ['/api/admin/dashboard', '/api/admin/orders', '/api/admin/products', '/api/admin/settings', '/api/admin/users', '/api/admin/audit', '/api/admin/reports/orders', '/api/seller/catalog']) {
      expect((await v.get(url)).status).toBe(403);
    }
  });

  it('vê somente as vendas do Victor, sem custo/margem', async () => {
    const victor = await loginVictor(app);
    const ana = await loginAna(app);
    const mine = await orderFor(victor, fx.clientVictor);
    const other = await orderFor(ana, fx.clientAna);
    const v = await makeManager();
    const list = await v.get('/api/manager/orders');
    expect(list.body.items.map((o: any) => o.id)).toEqual([mine.id]);
    expect((await v.get(`/api/manager/orders/${other.id}`)).status).toBe(404);
    const d = await v.get(`/api/manager/orders/${mine.id}`);
    expect(d.status).toBe(200);
    expect(JSON.stringify(d.body)).not.toMatch(/costCents|marginCents|internalTaxCents|unitCostCents/);
    expect((await v.get(`/api/manager/orders?salesRepId=${fx.anaRepId}`)).status).toBe(403);
    const dash = await v.get('/api/manager/dashboard');
    expect(dash.body.kpis.ordersInPeriod).toBe(1);
    expect(dash.body.byRep.map((r: any) => r.rep)).toEqual(['Victor Badur']);
    // PDF: do Victor sim, da Ana não
    const g = await victor.post(`/api/documents/orders/${mine.id}`);
    expect((await v.get(`/api/documents/file/${g.body.document.id}`)).status).toBe(200);
    const g2 = await ana.post(`/api/documents/orders/${other.id}`);
    expect((await v.get(`/api/documents/file/${g2.body.document.id}`)).status).toBe(404);
  });

  it('calculadora de comissão: 10% sobre o valor dos produtos (sem frete), com simulação de outra taxa', async () => {
    await prisma.salesRep.update({ where: { id: fx.victorRepId }, data: { commissionBps: 1000 } });
    const victor = await loginVictor(app);
    await orderFor(victor, fx.clientVictor, { generalDiscountBps: 500 }); // 1000,00 − 5% = 950,00 + frete 10,00
    await orderFor(await loginAna(app), fx.clientAna);
    const v = await makeManager();
    const c = await v.get('/api/manager/commissions');
    expect(c.body.totals).toEqual({ orders: 1, baseCents: 95_000, commissionCents: 9_500 });
    expect(c.body.lines[0]).toMatchObject({ rateBps: 1000, baseCents: 95_000, commissionCents: 9_500 });
    const sim = await v.get('/api/manager/commissions?rateBps=800');
    expect(sim.body.totals.commissionCents).toBe(7_600);
    const fulfilled = await v.get('/api/manager/commissions?basis=fulfilled');
    expect(fulfilled.body.totals.orders).toBe(0);
    const csv = await v.get('/api/manager/commissions?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain('95,00');
    // o administrador vê a comissão de todos
    const admin = await loginAdmin(app);
    expect((await admin.get('/api/admin/commissions')).body.totals.orders).toBe(2);
  });

  it('libera produtos (sem ver custo) e clientes somente do Victor', async () => {
    const v = await makeManager();
    const prods = await v.get('/api/manager/products?q=Inativo');
    expect(JSON.stringify(prods.body)).not.toMatch(/costCents|taxRefBps|margin/);
    expect((await v.post(`/api/manager/products/${fx.inactiveProduct}/active`, { active: true })).status).toBe(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: fx.inactiveProduct } })).active).toBe(true);
    expect((await v.post(`/api/manager/clients/${fx.clientPending}/status`, { status: 'ACTIVE' })).status).toBe(200);
    expect((await v.post(`/api/manager/clients/${fx.clientAna}/status`, { status: 'BLOCKED' })).status).toBe(404);
    const clients = await v.get('/api/manager/clients');
    expect(clients.body.items.map((c: any) => c.legalName).sort()).toEqual(['Cliente Pendente Ltda', 'Cliente do Victor Ltda']);
    expect(await prisma.auditLog.count({ where: { action: 'CLIENT_STATUS_CHANGED' } })).toBe(1);
  });

  it('ações não liberadas pelo administrador são recusadas no servidor', async () => {
    const victor = await loginVictor(app);
    const o = await orderFor(victor, fx.clientVictor);
    const v = await makeManager({ canReleaseProducts: false, canViewCommissions: false, canUpdateOrderStatus: false });
    expect((await v.post(`/api/manager/orders/${o.id}/status`, { status: 'APPROVED' })).status).toBe(403);
    expect((await v.get('/api/manager/approvals')).status).toBe(403);
    expect((await v.get('/api/manager/commissions')).status).toBe(403);
    expect((await v.post(`/api/manager/products/${fx.p1}/active`, { active: false })).status).toBe(403);
  });

  it('com permissão, aprova desconto e atualiza andamento dos pedidos do Victor', async () => {
    const victor = await loginVictor(app);
    const o = await orderFor(victor, fx.clientVictor, { action: 'REQUEST_APPROVAL', generalDiscountBps: 1000 });
    const v = await makeManager({ canApproveDiscounts: true, canUpdateOrderStatus: true });
    const ap = await v.get('/api/manager/approvals?status=PENDING');
    expect(ap.body.items).toHaveLength(1);
    expect(JSON.stringify(ap.body)).not.toMatch(/costCents|marginCents/);
    expect((await v.post(`/api/manager/approvals/${ap.body.items[0].id}/decide`, { decision: 'APPROVED' })).status).toBe(200);
    expect((await v.post(`/api/manager/orders/${o.id}/status`, { status: 'AWAITING_PICKING' })).status).toBe(200);
  });

  it('por padrão o gestor atualiza o andamento: Faturado → Em rota de entrega → Entregue', async () => {
    const victor = await loginVictor(app);
    const o = await orderFor(victor, fx.clientVictor);
    const v = await makeManager();
    for (const s of ['APPROVED', 'INVOICED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      const r = await v.post(`/api/manager/orders/${o.id}/status`, { status: s, note: s === 'INVOICED' ? 'NF 123' : null });
      expect(r.status, s).toBe(200);
    }
    const h = await victor.get(`/api/seller/orders/${o.id}/history`);
    expect(h.body.status.map((x: any) => x.toStatus)).toEqual(['CREATED', 'APPROVED', 'INVOICED', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    expect(h.body.status[2].user.name).toBe('Vinicius');
    // faturado entra como venda realizada na comissão "somente faturados"
    expect((await v.get('/api/manager/commissions?basis=fulfilled')).body.totals.orders).toBe(1);
  });

  it('produto sem preço de venda não pode ser ativado', async () => {
    await prisma.product.update({ where: { id: fx.inactiveProduct }, data: { priceCents: 0 } });
    const v = await makeManager();
    const r = await v.post(`/api/manager/products/${fx.inactiveProduct}/active`, { active: true });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('PRICE_REQUIRED');
    const admin = await loginAdmin(app);
    expect((await admin.post(`/api/admin/products/${fx.inactiveProduct}/active`, { active: true })).body.error).toBe('PRICE_REQUIRED');
    const ok = await admin.put(`/api/admin/products/${fx.inactiveProduct}`, { sku: 'B-005', name: 'Produto Inativo', brandId: fx.brandB, priceCents: 1500, active: true });
    expect(ok.status).toBe(200);
    expect(ok.body.active).toBe(true);
  });

  it('administrador cria gestor, define permissões e vendedores supervisionados', async () => {
    const admin = await loginAdmin(app);
    const c = await admin.post('/api/admin/users', { username: 'gestora', name: 'Gestora', password: 'Gestora2026', role: 'MANAGER', manager: { repIds: [fx.anaRepId], canApproveDiscounts: true } });
    expect(c.status).toBe(201);
    const users = await admin.get('/api/admin/users');
    const g = users.body.find((u: any) => u.username === 'gestora');
    expect(g.managerProfile.canApproveDiscounts).toBe(true);
    expect(g.managerProfile.reps).toEqual([{ salesRepId: fx.anaRepId }]);
    const u = await admin.put(`/api/admin/users/${g.id}/manager`, { repIds: [fx.victorRepId, fx.anaRepId], canViewCommissions: false });
    expect(u.status).toBe(200);
    expect(await prisma.managerRep.count()).toBe(2);
  });
});
