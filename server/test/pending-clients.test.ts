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
beforeEach(async () => {
  fx = await seedBase();
});

const NEW_CLIENT = {
  legalName: 'Barbearia Nova Ltda',
  tradeName: 'Barbearia Nova',
  cnpj: '04.252.011/0001-10',
  responsibleName: 'Carlos',
  commercialPhone: '(41) 98888-1111',
  city: 'Curitiba',
  state: 'PR',
};

async function manager(perms: Record<string, boolean> = {}) {
  await prisma.user.create({
    data: { username: 'vinicius', name: 'Vinicius', role: 'MANAGER', passwordHash: await hashPassword('123456'), managerProfile: { create: { ...perms, reps: { create: [{ salesRepId: fx.victorRepId }] } } } },
  });
  const a = new Agent(app);
  await a.login('vinicius', '123456');
  return a;
}

describe('Pendência cadastral', () => {
  it('vendedor cadastra cliente: fica em análise e serve só para orçamento', async () => {
    const v = await loginVictor(app);
    const r = await v.post('/api/seller/clients', { ...NEW_CLIENT, status: 'ACTIVE', salesRepId: fx.anaRepId });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('UNDER_REVIEW'); // vendedor não escolhe status nem vendedor
    const c = await prisma.client.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(c.salesRepId).toBe(fx.victorRepId);
    expect(await prisma.auditLog.count({ where: { action: 'CLIENT_SUBMITTED' } })).toBe(1);

    const panel = await v.get(`/api/seller/clients/${c.id}`);
    expect(panel.body).toMatchObject({ selectable: true, canOrder: false, pendingApproval: true });

    // orçamento: permitido
    const q = await v.post('/api/seller/quotes', { idempotencyKey: key(), clientId: c.id, items: [{ productId: fx.p1, quantity: 2 }] });
    expect(q.status).toBe(201);
    // pedido: bloqueado
    const o = await v.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId: c.id, items: [{ productId: fx.p1, quantity: 1 }] });
    expect(o.status).toBe(422);
    expect(o.body.error).toBe('CLIENT_PENDING_APPROVAL');
    // converter orçamento: bloqueado até aprovar
    const prev = await v.get(`/api/seller/quotes/${q.body.quote.id}/conversion-preview`);
    expect(prev.body.canConvert).toBe(false);
    expect(prev.body.blockers.join(' ')).toMatch(/aguarda aprovação/);
  });

  it('aparece para o administrador e para o gestor; aprovação libera pedido e conversão', async () => {
    const v = await loginVictor(app);
    const id = (await v.post('/api/seller/clients', NEW_CLIENT)).body.id;
    const q = (await v.post('/api/seller/quotes', { idempotencyKey: key(), clientId: id, items: [{ productId: fx.p1, quantity: 2 }] })).body.quote;

    const admin = await loginAdmin(app);
    const ap = await admin.get('/api/admin/clients-pending');
    expect(ap.body.items.map((c: any) => c.legalName)).toContain('Barbearia Nova Ltda');
    expect(ap.body.items.find((c: any) => c.id === id)).toMatchObject({ createdByName: 'Victor Badur', quoteCount: 1 });

    const g = await manager();
    const mp = await g.get('/api/manager/clients-pending');
    expect(mp.body.items.map((c: any) => c.id)).toContain(id);
    const r = await g.post(`/api/manager/clients/${id}/review`, { decision: 'APPROVE' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ACTIVE');
    expect((await admin.post(`/api/admin/clients/${id}/review`, { decision: 'APPROVE' })).status).toBe(409); // já decidido

    const conv = await v.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key() });
    expect(conv.status).toBe(201);
    const o = await v.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId: id, items: [{ productId: fx.p2, quantity: 1 }] });
    expect(o.status).toBe(201);
    expect(await prisma.auditLog.count({ where: { action: 'CLIENT_APPROVED' } })).toBe(1);
  });

  it('devolver para correção exige motivo; vendedor corrige e volta para análise', async () => {
    const v = await loginVictor(app);
    const id = (await v.post('/api/seller/clients', NEW_CLIENT)).body.id;
    const admin = await loginAdmin(app);
    expect((await admin.post(`/api/admin/clients/${id}/review`, { decision: 'RETURN' })).status).toBe(422);
    await admin.post(`/api/admin/clients/${id}/review`, { decision: 'RETURN', note: 'Falta a inscrição estadual' });
    const p = await v.get(`/api/seller/clients/${id}`);
    expect(p.body).toMatchObject({ status: 'PENDING_REGISTRATION', reviewNote: 'Falta a inscrição estadual', editable: true });
    const fix = await v.put(`/api/seller/clients/${id}`, { ...NEW_CLIENT, stateRegistration: '123456' });
    expect(fix.body.status).toBe('UNDER_REVIEW');
    // recusado: bloqueado e não editável
    await admin.post(`/api/admin/clients/${id}/review`, { decision: 'REJECT', note: 'CNPJ irregular' });
    expect((await v.put(`/api/seller/clients/${id}`, NEW_CLIENT)).status).toBe(422);
    expect((await v.post('/api/seller/quotes', { idempotencyKey: key(), clientId: id, items: [{ productId: fx.p1, quantity: 1 }] })).body.error).toBe('CLIENT_NOT_ACTIVE');
  });

  it('CNPJ duplicado não revela dados de outro vendedor; gestor só cadastra para quem acompanha', async () => {
    const ana = await loginAna(app);
    const dup = await ana.post('/api/seller/clients', { ...NEW_CLIENT, cnpj: '11.222.333/0001-81' }); // cliente do Victor
    expect(dup.status).toBe(409);
    expect(dup.body.message).not.toContain('Victor');
    const g = await manager();
    expect((await g.post('/api/manager/clients', { ...NEW_CLIENT, salesRepId: fx.anaRepId, status: 'ACTIVE' })).status).toBe(403);
    const ok = await g.post('/api/manager/clients', { ...NEW_CLIENT, salesRepId: fx.victorRepId, status: 'ACTIVE' });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('ACTIVE');
    // gestor sem permissão de liberar: cadastro entra em análise e não vê pendências
    await prisma.managerProfile.updateMany({ data: { canReleaseClients: false } });
    const g2 = new Agent(app);
    await g2.login('vinicius', '123456');
    const c2 = await g2.post('/api/manager/clients', { ...NEW_CLIENT, cnpj: '22334455000186', salesRepId: fx.victorRepId, status: 'ACTIVE' });
    expect(c2.status).toBe(201);
    expect(c2.body.status).toBe('UNDER_REVIEW');
    expect((await g2.get('/api/manager/clients-pending')).status).toBe(403);
  });
});
