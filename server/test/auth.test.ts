import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN, Agent, ANA, VICTOR, loginAdmin, loginAna, loginVictor, makeApp, prisma, seedBase, type Fixtures } from './helpers';

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

describe('Autenticação', () => {
  it('login do administrador', async () => {
    const a = new Agent(app);
    const r = await a.login(ADMIN.username, ADMIN.password);
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('ADMIN');
    expect(r.body.csrfToken).toBeTruthy();
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const me = await a.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('admin');
  });

  it('login do vendedor exige troca da senha inicial antes de usar o sistema', async () => {
    const a = new Agent(app);
    const r = await a.login(VICTOR.username, VICTOR.initial);
    expect(r.status).toBe(200);
    expect(r.body.user.mustChangePassword).toBe(true);
    expect(r.body.rep.fullName).toBe('Victor Badur');
    // bloqueado até trocar a senha
    expect((await a.get('/api/seller/clients')).status).toBe(403);
    // senha fraca é recusada
    expect((await a.post('/api/auth/change-password', { currentPassword: '1234', newPassword: '12345678' })).status).toBe(400);
    const c = await a.post('/api/auth/change-password', { currentPassword: '1234', newPassword: VICTOR.password });
    expect(c.status).toBe(200);
    expect((await a.get('/api/seller/clients')).status).toBe(200);
    // a senha nunca é armazenada em texto puro
    const u = await prisma.user.findUniqueOrThrow({ where: { username: 'victor' } });
    expect(u.passwordHash).not.toContain(VICTOR.password);
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('senha errada retorna mensagem genérica e bloqueia após 5 tentativas', async () => {
    const a = new Agent(app);
    for (let i = 0; i < 5; i++) {
      const r = await a.login(ANA.username, 'errada');
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Usuário ou senha inválidos.');
    }
    const locked = await a.login(ANA.username, ANA.password);
    expect(locked.status).toBe(423);
    const logs = await prisma.auditLog.count({ where: { action: { in: ['LOGIN_FAILED', 'LOGIN_LOCKED'] } } });
    expect(logs).toBe(5);
  });

  it('usuário inexistente recebe a mesma mensagem', async () => {
    const r = await new Agent(app).login('naoexiste', 'x');
    expect(r.status).toBe(401);
    expect(r.body.message).toBe('Usuário ou senha inválidos.');
  });

  it('vendedor bloqueado não consegue entrar e perde as sessões', async () => {
    const ana = await loginAna(app);
    const admin = await loginAdmin(app);
    expect((await admin.post(`/api/admin/reps/${fx.anaRepId}/active`, { active: false })).status).toBe(200);
    expect((await ana.get('/api/seller/clients')).status).toBe(401);
    expect((await new Agent(app).login(ANA.username, ANA.password)).status).toBe(403);
  });

  it('requisições sem token CSRF são recusadas', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post('/api/admin/brands', { name: 'Sem CSRF' }, { csrf: false });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('CSRF');
  });

  it('logout encerra a sessão', async () => {
    const admin = await loginAdmin(app);
    await admin.post('/api/auth/logout');
    expect((await admin.get('/api/auth/me')).status).toBe(401);
  });
});

describe('Bloqueio de acesso indevido', () => {
  it('sem login nada é acessível', async () => {
    const a = new Agent(app);
    for (const url of ['/api/admin/clients', '/api/seller/clients', '/api/admin/products', '/api/seller/catalog', `/api/documents/orders/${fx.clientVictor}`]) {
      expect((await a.get(url)).status).toBe(401);
    }
  });

  it('vendedor não acessa NENHUMA rota administrativa, mesmo chamando a API diretamente', async () => {
    const v = await loginVictor(app);
    const urls = ['/api/admin/clients', '/api/admin/products', '/api/admin/reps', '/api/admin/settings', '/api/admin/orders', '/api/admin/dashboard', '/api/admin/audit', '/api/admin/reports/orders', '/api/admin/pricing-rules'];
    for (const url of urls) expect((await v.get(url)).status).toBe(403);
    // tentativas de escrita
    expect((await v.put(`/api/admin/products/${fx.p1}`, { sku: 'A-001', name: 'x', brandId: fx.brandA, priceCents: 1, costCents: 1 })).status).toBe(403);
    expect((await v.post('/api/admin/pricing-rules', { name: 'x', kind: 'SURCHARGE', base: 'NET', scope: 'ALL', rateBps: 0 })).status).toBe(403);
    expect((await v.post(`/api/admin/reps/${fx.victorRepId}/active`, { active: true })).status).toBe(403);
    const p = await prisma.product.findUniqueOrThrow({ where: { id: fx.p1 } });
    expect(p.costCents).toBe(6000);
  });

  it('administrador não usa rotas exclusivas do vendedor', async () => {
    const admin = await loginAdmin(app);
    expect((await admin.get('/api/seller/catalog')).status).toBe(403);
  });
});
