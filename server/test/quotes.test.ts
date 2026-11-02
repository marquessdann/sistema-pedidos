import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { key, loginAdmin, loginVictor, makeApp, prisma, seedBase, type Agent, type Fixtures } from './helpers';

let app: FastifyInstance;
let fx: Fixtures;
let victor: Agent;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  fx = await seedBase();
  victor = await loginVictor(app);
});

function quoteBody(extra: Record<string, unknown> = {}) {
  return {
    idempotencyKey: key('q'),
    clientId: fx.clientVictor,
    paymentTermId: fx.termId,
    items: [
      { productId: fx.p1, quantity: 2 },
      { productId: fx.p3, quantity: 1 },
    ],
    generalDiscountBps: 300,
    notes: 'Entrega em 10 dias',
    ...extra,
  };
}

describe('Orçamentos', () => {
  it('gera orçamento com o mesmo motor de cálculo, validade padrão e status rascunho', async () => {
    const r = await victor.post('/api/seller/quotes', quoteBody());
    expect(r.status).toBe(201);
    const q = r.body.quote;
    expect(q.number).toMatch(/^ORC-\d{4}-000001$/);
    expect(q.status).toBe('DRAFT');
    expect(q.grossCents).toBe(120_000);
    expect(q.generalDiscountCents).toBe(3_600);
    expect(q.totalCents).toBe(116_400);
    expect(q.validUntil > q.quoteDate).toBe(true);
    expect(await prisma.order.count()).toBe(0); // orçamento não é pedido
  });

  it('edita orçamento válido; vendedor registra status (enviado ao cliente)', async () => {
    const q = (await victor.post('/api/seller/quotes', quoteBody())).body.quote;
    const e = await victor.put(`/api/seller/quotes/${q.id}`, quoteBody({ items: [{ productId: fx.p2, quantity: 10 }], generalDiscountBps: 0 }));
    expect(e.status).toBe(200);
    expect(e.body.quote.totalCents).toBe(25_500);
    const s = await victor.post(`/api/seller/quotes/${q.id}/status`, { status: 'SENT' });
    expect(s.body.status).toBe('SENT');
  });

  it('orçamento expirado não pode ser editado nem convertido', async () => {
    const q = (await victor.post('/api/seller/quotes', quoteBody())).body.quote;
    await prisma.quote.update({ where: { id: q.id }, data: { validUntil: new Date('2020-01-01T00:00:00Z') } });
    const got = await victor.get(`/api/seller/quotes/${q.id}`);
    expect(got.body.status).toBe('EXPIRED');
    expect((await victor.put(`/api/seller/quotes/${q.id}`, quoteBody())).body.error).toBe('QUOTE_LOCKED');
    const prev = await victor.get(`/api/seller/quotes/${q.id}/conversion-preview`);
    expect(prev.body.canConvert).toBe(false);
  });

  it('transforma orçamento em pedido vinculado, preservando valores e histórico', async () => {
    const q = (await victor.post('/api/seller/quotes', quoteBody())).body.quote;
    const prev = await victor.get(`/api/seller/quotes/${q.id}/conversion-preview`);
    expect(prev.body.canConvert).toBe(true);
    expect(prev.body.priceChanged).toBe(false);
    const c = await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key('conv') });
    expect(c.status).toBe(201);
    const o = c.body.order;
    expect(o.number).toMatch(/^PED-/);
    expect(o.quote.number).toBe(q.number);
    expect(o.totalCents).toBe(q.totalCents);
    expect(o.generalDiscountBps).toBe(300);
    expect(o.notes).toBe('Entrega em 10 dias');
    const after = await victor.get(`/api/seller/quotes/${q.id}`);
    expect(after.body.status).toBe('CONVERTED');
    expect(after.body.convertedOrder.id).toBe(o.id);
    expect(after.body.statusHistory.map((h: any) => h.toStatus)).toEqual(['DRAFT', 'CONVERTED']);
    expect(after.body.items).toHaveLength(2); // itens do orçamento preservados
  });

  it('bloqueia conversão duplicada (sequencial e simultânea)', async () => {
    const q = (await victor.post('/api/seller/quotes', quoteBody())).body.quote;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key('conv') })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 201 || r.status === 409)).toHaveLength(5);
    expect(await prisma.order.count({ where: { quoteId: q.id } })).toBe(1);
    const again = await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key('conv') });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('ALREADY_CONVERTED');
  });

  it('reenvio da mesma conversão devolve o pedido já criado', async () => {
    const q = (await victor.post('/api/seller/quotes', quoteBody())).body.quote;
    const k = key('conv');
    const a = await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: k });
    const b = await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: k });
    expect(b.status).toBe(200);
    expect(b.body.duplicate).toBe(true);
    expect(b.body.order.id).toBe(a.body.order.id);
  });

  it('preço alterado após o orçamento: avisa e mantém os valores aprovados (política padrão)', async () => {
    const q = (await victor.post('/api/seller/quotes', quoteBody())).body.quote;
    await prisma.product.update({ where: { id: fx.p1 }, data: { priceCents: 15_000 } });
    const prev = await victor.get(`/api/seller/quotes/${q.id}/conversion-preview`);
    expect(prev.body.priceChanged).toBe(true);
    const noAck = await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key() });
    expect(noAck.status).toBe(422);
    expect(noAck.body.error).toBe('PRICE_CHANGED');
    const ok = await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key(), acknowledgePriceChange: true });
    expect(ok.body.order.totalCents).toBe(q.totalCents);
    expect(ok.body.order.items.find((i: any) => i.sku === 'A-001').unitPriceCents).toBe(10_000);
  });

  it('desconto acima do limite no orçamento exige aprovação antes de PDF/envio/conversão', async () => {
    const blocked = await victor.post('/api/seller/quotes', quoteBody({ generalDiscountBps: 1000 }));
    expect(blocked.body.error).toBe('DISCOUNT_LIMIT');
    const q = (await victor.post('/api/seller/quotes', quoteBody({ generalDiscountBps: 1000, requestApproval: true }))).body.quote;
    expect(q.discountApprovalStatus).toBe('PENDING');
    expect((await victor.post(`/api/documents/quotes/${q.id}`)).body.error).toBe('APPROVAL_PENDING');
    expect((await victor.post(`/api/seller/quotes/${q.id}/status`, { status: 'SENT' })).body.error).toBe('APPROVAL_PENDING');
    expect((await victor.get(`/api/seller/quotes/${q.id}/conversion-preview`)).body.canConvert).toBe(false);
    const admin = await loginAdmin(app);
    const ap = await prisma.discountApproval.findFirstOrThrow({ where: { quoteId: q.id } });
    await admin.post(`/api/admin/approvals/${ap.id}/decide`, { decision: 'APPROVED' });
    const c = await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key() });
    expect(c.status).toBe(201);
    expect(c.body.order.discountApprovalStatus).toBe('APPROVED');
    expect(c.body.order.status).toBe('CREATED');
  });

  it('administrador pode liberar nova conversão somente após cancelar o pedido, com justificativa', async () => {
    const q = (await victor.post('/api/seller/quotes', quoteBody())).body.quote;
    const o = (await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key() })).body.order;
    const admin = await loginAdmin(app);
    expect((await admin.post(`/api/admin/quotes/${q.id}/allow-reconversion`, { reason: 'Pedido lançado com erro' })).status).toBe(422);
    await admin.post(`/api/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'Lançado com erro' });
    expect((await admin.post(`/api/admin/quotes/${q.id}/allow-reconversion`, { reason: 'Pedido lançado com erro' })).status).toBe(200);
    const c2 = await victor.post(`/api/seller/quotes/${q.id}/convert`, { idempotencyKey: key() });
    expect(c2.status).toBe(201);
    expect(c2.body.order.id).not.toBe(o.id);
  });

  it('duplica orçamento', async () => {
    const q = (await victor.post('/api/seller/quotes', quoteBody())).body.quote;
    const d = await victor.post(`/api/seller/quotes/${q.id}/duplicate`, { idempotencyKey: key() });
    expect(d.status).toBe(201);
    expect(d.body.quote.number).not.toBe(q.number);
    expect(d.body.quote.totalCents).toBe(q.totalCents);
  });
});
