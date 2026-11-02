import type { FastifyInstance } from 'fastify';
import { DEFAULT_ORDER_TRANSITIONS } from '@della/shared';
import { buildApp, type AppDeps } from '../src/app';
import { prisma } from '../src/db';
import { hashPassword } from '../src/lib/password';

export { prisma };

export const ADMIN = { username: 'admin', password: 'AdminTeste2026' };
export const VICTOR = { username: 'victor', initial: '1234', password: 'Badur2026Nova' };
export const ANA = { username: 'ana', password: 'AnaTeste2026' };

/** Limpa TODAS as tabelas do banco de teste (proteção: só executa em bancos com "test" no nome). */
export async function resetDb() {
  if (!/test/i.test(process.env.DATABASE_URL ?? '')) throw new Error('resetDb só pode rodar no banco de teste.');
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export interface Fixtures {
  victorRepId: string;
  anaRepId: string;
  brandA: string;
  brandB: string;
  catId: string;
  p1: string; // R$ 100,00 custo 60,00
  p2: string; // R$ 25,50 custo 10,00
  p3: string; // R$ 1.000,00
  inactiveProduct: string;
  clientVictor: string;
  clientAna: string;
  clientPending: string;
  termId: string;
}

export async function seedBase(): Promise<Fixtures> {
  await resetDb();
  await prisma.companySettings.create({ data: { id: 1, companyName: 'Della Teste', cnpj: '11222333000181' } });
  await prisma.orderStatusTransition.createMany({ data: DEFAULT_ORDER_TRANSITIONS.map(([fromStatus, toStatus]) => ({ fromStatus, toStatus })) });
  const term = await prisma.paymentTerm.create({ data: { name: '30/60 dias', days: '30/60' } });
  await prisma.user.create({ data: { username: ADMIN.username, name: 'Admin Teste', role: 'ADMIN', passwordHash: await hashPassword(ADMIN.password) } });
  const victor = await prisma.user.create({
    data: {
      username: VICTOR.username,
      name: 'Victor Badur',
      role: 'SELLER',
      mustChangePassword: true,
      passwordHash: await hashPassword(VICTOR.initial),
      salesRep: { create: { fullName: 'Victor Badur', maxDiscountBps: 500, phone: '11988887777', cpf: '52998224725' } },
    },
    include: { salesRep: true },
  });
  const ana = await prisma.user.create({
    data: {
      username: ANA.username,
      name: 'Ana Vendedora',
      role: 'SELLER',
      passwordHash: await hashPassword(ANA.password),
      salesRep: { create: { fullName: 'Ana Vendedora', maxDiscountBps: 1000 } },
    },
    include: { salesRep: true },
  });
  const brandA = await prisma.brand.create({ data: { name: 'Marca A' } });
  const brandB = await prisma.brand.create({ data: { name: 'Marca B' } });
  const cat = await prisma.category.create({ data: { name: 'Categoria 1' } });
  const mk = (sku: string, name: string, brandId: string, price: number, cost: number, active = true) =>
    prisma.product.create({ data: { sku, name, brandId, categoryId: cat.id, priceCents: price, costCents: cost, active, stockQty: 50 } });
  const p1 = await mk('A-001', 'Produto 001', brandA.id, 10_000, 6_000);
  const p2 = await mk('A-002', 'Produto 002', brandA.id, 2_550, 1_000);
  const p3 = await mk('B-004', 'Produto 004', brandB.id, 100_000, 70_000);
  const p4 = await mk('B-005', 'Produto Inativo', brandB.id, 5_000, 1_000, false);
  const mkClient = (cnpj: string, legalName: string, salesRepId: string, status: 'ACTIVE' | 'UNDER_REVIEW' = 'ACTIVE') =>
    prisma.client.create({ data: { cnpj, legalName, salesRepId, status, commercialEmail: 'compras@cliente.test', financeEmail: 'fin@cliente.test' } });
  const c1 = await mkClient('11222333000181', 'Cliente do Victor Ltda', victor.salesRep!.id);
  const c2 = await mkClient('11444777000161', 'Cliente da Ana Ltda', ana.salesRep!.id);
  const c3 = await mkClient('45723174000110', 'Cliente Pendente Ltda', victor.salesRep!.id, 'UNDER_REVIEW');
  return {
    victorRepId: victor.salesRep!.id,
    anaRepId: ana.salesRep!.id,
    brandA: brandA.id,
    brandB: brandB.id,
    catId: cat.id,
    p1: p1.id,
    p2: p2.id,
    p3: p3.id,
    inactiveProduct: p4.id,
    clientVictor: c1.id,
    clientAna: c2.id,
    clientPending: c3.id,
    termId: term.id,
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
  raw: Buffer;
}

/** Cliente HTTP de teste que mantém cookie de sessão e token CSRF, como o navegador. */
export class Agent {
  cookie = '';
  csrf = '';
  constructor(public app: FastifyInstance) {}

  async request<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, opts: { csrf?: boolean } = {}): Promise<Res<T>> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== 'GET' && opts.csrf !== false && this.csrf) headers['x-csrf-token'] = this.csrf;
    const res = await this.app.inject({ method, url, payload: payload as never, headers });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      this.cookie = first.split(';')[0];
    }
    let body: any = res.body;
    if ((res.headers['content-type'] ?? '').toString().includes('application/json')) body = res.json();
    if (body && typeof body === 'object' && 'csrfToken' in body && body.csrfToken) this.csrf = body.csrfToken;
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown>, raw: res.rawPayload };
  }
  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, payload?: unknown, opts?: { csrf?: boolean }) {
    return this.request<T>('POST', url, payload ?? {}, opts);
  }
  put<T = any>(url: string, payload?: unknown) {
    return this.request<T>('PUT', url, payload ?? {});
  }
  del<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }
  async login(username: string, password: string) {
    return this.post('/api/auth/login', { username, password });
  }
}

export async function makeApp(deps: AppDeps = {}) {
  return buildApp({ logger: false, ...deps });
}

export async function loginAdmin(app: FastifyInstance) {
  const a = new Agent(app);
  const r = await a.login(ADMIN.username, ADMIN.password);
  if (r.status !== 200) throw new Error(`login admin falhou: ${JSON.stringify(r.body)}`);
  return a;
}

/** Login do Victor já com a troca obrigatória de senha realizada. */
export async function loginVictor(app: FastifyInstance) {
  const a = new Agent(app);
  let r = await a.login(VICTOR.username, VICTOR.password);
  if (r.status !== 200) {
    r = await a.login(VICTOR.username, VICTOR.initial);
    if (r.status !== 200) throw new Error(`login victor falhou: ${JSON.stringify(r.body)}`);
    const c = await a.post('/api/auth/change-password', { currentPassword: VICTOR.initial, newPassword: VICTOR.password });
    if (c.status !== 200) throw new Error(`troca de senha falhou: ${JSON.stringify(c.body)}`);
  }
  return a;
}

export async function loginAna(app: FastifyInstance) {
  const a = new Agent(app);
  const r = await a.login(ANA.username, ANA.password);
  if (r.status !== 200) throw new Error(`login ana falhou: ${JSON.stringify(r.body)}`);
  return a;
}

let keyCounter = 0;
export function key(prefix = 'k') {
  keyCounter += 1;
  return `${prefix}-${Date.now()}-${keyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}
