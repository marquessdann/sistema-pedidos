import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Agent, loginAdmin, loginVictor, makeApp, prisma, seedBase, type Fixtures } from './helpers';

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

const validClient = {
  legalName: 'Mercado Novo Ltda',
  tradeName: 'Mercado Novo',
  cnpj: '04.252.011/0001-10',
  responsibleName: 'João',
  financeEmail: 'fin@novo.com.br',
  financePhone: '(11) 3456-7890',
  commercialPhone: '(11) 98765-4321',
  commercialEmail: 'compras@novo.com.br',
  cep: '01310-100',
  state: 'SP',
  city: 'São Paulo',
  district: 'Bela Vista',
  street: 'Av. Paulista',
  number: '1000',
  status: 'ACTIVE',
};

describe('Cadastro de clientes', () => {
  it('cadastra cliente, normaliza dados e registra autoria', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post('/api/admin/clients', { ...validClient, salesRepId: fx.victorRepId });
    expect(r.status).toBe(201);
    expect(r.body.cnpj).toBe('04252011000110');
    expect(r.body.financePhone).toBe('1134567890');
    expect(r.body.createdById).toBeTruthy();
    const detail = await admin.get(`/api/admin/clients/${r.body.id}`);
    expect(detail.body.createdByName).toBe('Admin Teste');
    expect(await prisma.auditLog.count({ where: { action: 'CLIENT_CREATED', entityId: r.body.id } })).toBe(1);
  });

  it('valida CNPJ inválido', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post('/api/admin/clients', { ...validClient, cnpj: '04.252.011/0001-11', salesRepId: fx.victorRepId });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/CNPJ inválido/);
  });

  it('impede CNPJ duplicado e alerta duplicidade', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post('/api/admin/clients', { ...validClient, cnpj: '11.222.333/0001-81', salesRepId: fx.victorRepId });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('DUPLICATE_CNPJ');
    const check = await admin.post('/api/admin/clients/check-duplicate', { cnpj: '11222333000181', legalName: 'Cliente do Victor' });
    expect(check.body.cnpjDuplicate.legalName).toBe('Cliente do Victor Ltda');
  });

  it('cliente ativo exige vendedor responsável', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post('/api/admin/clients', { ...validClient });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('CLIENT_NEEDS_REP');
  });

  it('importa dados por texto (WhatsApp) para revisão', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post('/api/admin/clients/parse-text', { text: 'Razão social: Loja X Ltda\nCNPJ 04252011000110\nE-mail financeiro: a@b.com' });
    expect(r.body.data.legalName).toBe('Loja X Ltda');
    expect(r.body.data.cnpj).toBe('04.252.011/0001-10');
    expect(r.body.data.financeEmail).toBe('a@b.com');
  });

  it('cliente ativado aparece para o vendedor autorizado; pendente não pode ser usado', async () => {
    const admin = await loginAdmin(app);
    const created = await admin.post('/api/admin/clients', { ...validClient, status: 'UNDER_REVIEW', salesRepId: fx.victorRepId });
    const v = await loginVictor(app);
    let list = await v.get('/api/seller/clients?onlyActive=true&q=Mercado');
    expect(list.body.items).toHaveLength(0);
    await admin.put(`/api/admin/clients/${created.body.id}`, { ...validClient, status: 'ACTIVE', salesRepId: fx.victorRepId });
    list = await v.get('/api/seller/clients?onlyActive=true&q=04252011');
    expect(list.body.items).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'CLIENT_STATUS_CHANGED' } })).toBe(1);
  });
});

describe('Cadastro de produtos', () => {
  it('cadastra produto com custo, imposto de referência e calcula margem', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post('/api/admin/products', {
      sku: 'c-777',
      name: 'Produto Novo',
      brandId: fx.brandA,
      categoryId: fx.catId,
      unit: 'cx',
      costCents: 5_000,
      taxRefBps: 1_000,
      priceCents: 10_000,
      stockQty: 10,
    });
    expect(r.status).toBe(201);
    expect(r.body.sku).toBe('C-777');
    expect(r.body.unit).toBe('CX');
    expect(r.body.marginCents).toBe(4_000); // 100 - 50 - 10
    expect(r.body.marginBps).toBe(4000);
    expect(await prisma.stockMovement.count({ where: { productId: r.body.id, type: 'IN' } })).toBe(1);
  });

  it('impede SKU duplicado', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post('/api/admin/products', { sku: 'A-001', name: 'Dup', brandId: fx.brandA, priceCents: 1 });
    expect(r.status).toBe(409);
  });

  it('pesquisa por SKU (admin e vendedor)', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.get('/api/admin/products?q=B-004');
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0].name).toBe('Produto 004');
    const v = await loginVictor(app);
    const c = await v.get('/api/seller/catalog?q=a-002');
    expect(c.body.brands).toHaveLength(1);
    expect(c.body.brands[0].products[0].sku).toBe('A-002');
  });

  it('catálogo do vendedor agrupa por marca e NÃO expõe custo, margem ou tributos', async () => {
    const v = await loginVictor(app);
    const c = await v.get('/api/seller/catalog');
    expect(c.body.brands.map((b: any) => b.name)).toEqual(['Marca A', 'Marca B']);
    const json = JSON.stringify(c.body);
    expect(json).not.toMatch(/costCents|taxRefBps|internalNotes|margin/);
    // produto inativo não aparece
    expect(json).not.toContain('Produto Inativo');
  });

  it('alteração de preço registra histórico e auditoria', async () => {
    const admin = await loginAdmin(app);
    await admin.put(`/api/admin/products/${fx.p1}`, { sku: 'A-001', name: 'Produto 001', brandId: fx.brandA, priceCents: 12_000, costCents: 6_000 });
    expect(await prisma.productPriceHistory.count({ where: { productId: fx.p1 } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'PRODUCT_PRICE_CHANGED', entityId: fx.p1 } })).toBe(1);
  });

  it('imagens ficam no banco (hospedagem sem disco), são servidas autenticadas e copiadas ao duplicar', async () => {
    const admin = await loginAdmin(app);
    // PNG 1x1 válido
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const boundary = '----della';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({ method: 'POST', url: `/api/admin/products/${fx.p1}/images`, payload: body, headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(up.statusCode).toBe(201);
    const fileName = up.json()[0].fileName;
    expect(await prisma.storedFile.count({ where: { fileName } })).toBe(1);
    const v = await loginVictor(app);
    const img = await v.get(`/api/files/products/${fileName}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect((await new Agent(app).get(`/api/files/products/${fileName}`)).status).toBe(401);
    // arquivo que não é imagem é recusado
    const bad = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from('não sou imagem'), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const r2 = await app.inject({ method: 'POST', url: `/api/admin/products/${fx.p1}/images`, payload: bad, headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(r2.statusCode).toBe(415);
    const dup = await admin.post(`/api/admin/products/${fx.p1}/duplicate`);
    const copy = await prisma.productImage.findFirstOrThrow({ where: { productId: dup.body.id } });
    expect(copy.fileName).not.toBe(fileName);
    expect(await prisma.storedFile.count()).toBe(2);
  });

  it('cadastra "unidades por caixa" e o vendedor vê no catálogo', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.put(`/api/admin/products/${fx.p1}`, { sku: 'A-001', name: 'Produto 001', brandId: fx.brandA, priceCents: 10_000, costCents: 6_000, unitsPerBox: 24 });
    expect(r.body.unitsPerBox).toBe(24);
    expect((await admin.put(`/api/admin/products/${fx.p1}`, { sku: 'A-001', name: 'Produto 001', brandId: fx.brandA, priceCents: 10_000, unitsPerBox: 1 })).status).toBe(400);
    const v = await loginVictor(app);
    const cat = await v.get('/api/seller/catalog?q=A-001');
    expect(cat.body.brands[0].products[0].unitsPerBox).toBe(24);
  });

  it('duplica produto como inativo', async () => {
    const admin = await loginAdmin(app);
    const r = await admin.post(`/api/admin/products/${fx.p1}/duplicate`);
    expect(r.status).toBe(201);
    expect(r.body.sku).toBe('A-001-COPIA');
    expect(r.body.active).toBe(false);
  });
});

describe('Exportar planilha de produtos', () => {
  it('admin baixa CSV com SKU, preço e estoque; vendedor não', async () => {
    const fx = await seedBase();
    const a = await loginAdmin(app);
    const r = await a.get('/api/admin/products-export');
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('text/csv');
    expect(r.body).toContain('SKU;Produto;Marca');
    expect(r.body).toContain('A-001;Produto 001;Marca A');
    expect(r.body).toContain('100,00');
    const v = await loginVictor(app);
    expect((await v.get('/api/admin/products-export')).status).toBe(403);
    expect(fx.p1).toBeTruthy();
  });
});
