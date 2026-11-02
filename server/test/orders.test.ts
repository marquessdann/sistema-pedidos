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

function orderBody(extra: Record<string, unknown> = {}) {
  return {
    idempotencyKey: key('ord'),
    action: 'CONFIRM',
    clientId: fx.clientVictor,
    paymentTermId: fx.termId,
    items: [
      { productId: fx.p1, quantity: 3 }, // 300,00
      { productId: fx.p2, quantity: 4 }, // 102,00
      { productId: fx.p3, quantity: 1 }, // 1.000,00 (outra marca)
    ],
    generalDiscountBps: 0,
    freightCents: 0,
    ...extra,
  };
}

describe('Pedidos', () => {
  it('adiciona vários produtos de marcas diferentes e calcula subtotal e total no backend', async () => {
    const r = await victor.post('/api/seller/orders', orderBody());
    expect(r.status).toBe(201);
    const o = r.body.order;
    expect(o.number).toMatch(/^PED-\d{4}-000001$/);
    expect(o.status).toBe('CREATED');
    expect(o.items).toHaveLength(3);
    expect(o.grossCents).toBe(140_200);
    expect(o.totalCents).toBe(140_200);
    expect(o.totalQuantity).toBe(8);
    // cópia dos dados comerciais no item
    expect(o.items[0]).toMatchObject({ sku: 'A-001', productName: 'Produto 001', brandName: 'Marca A', unitPriceCents: 10_000 });
    // dados internos não são devolvidos ao vendedor
    expect(JSON.stringify(o)).not.toMatch(/costCents|marginCents|internalTaxCents|unitCostCents/);
  });

  it('ignora preços enviados pelo navegador (cálculo confiável no servidor)', async () => {
    const body = orderBody({ items: [{ productId: fx.p1, quantity: 1, unitPriceCents: 1 }], totalCents: 1 });
    const r = await victor.post('/api/seller/orders', body);
    expect(r.body.order.totalCents).toBe(10_000);
  });

  it('desconto percentual do vendedor: 5% sobre R$ 1.000,00 = R$ 950,00', async () => {
    const r = await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p3, quantity: 1 }], generalDiscountBps: 500 }));
    expect(r.status).toBe(201);
    expect(r.body.order.generalDiscountCents).toBe(5_000);
    expect(r.body.order.totalCents).toBe(95_000);
  });

  it('total final considera desconto por item, desconto geral, acréscimos configurados e frete', async () => {
    const admin = await loginAdmin(app);
    await admin.post('/api/admin/pricing-rules', { name: 'Acréscimo teste', kind: 'SURCHARGE', base: 'NET', scope: 'BRAND', brandId: fx.brandB, rateBps: 1000 });
    await admin.post('/api/admin/pricing-rules', { name: 'Tributo interno', kind: 'INTERNAL_ESTIMATE', base: 'NET', scope: 'ALL', rateBps: 500 });
    const r = await victor.post(
      '/api/seller/orders',
      orderBody({ items: [{ productId: fx.p1, quantity: 2, discountBps: 200 }, { productId: fx.p3, quantity: 1 }], generalDiscountBps: 200, freightCents: 2_500 }),
    );
    const o = r.body.order;
    // bruto 1.200,00; desc item 2% de 200,00 = 4,00 → 1.196,00; geral 2% = 23,92 → 1.172,08
    expect(o.grossCents).toBe(120_000);
    expect(o.itemDiscountCents).toBe(400);
    expect(o.generalDiscountCents).toBe(2_392);
    // acréscimo 10% sobre líquido da linha da Marca B (1000,00 − rateio do desconto geral)
    const lineB = o.items.find((i: any) => i.sku === 'B-004');
    expect(o.surchargeCents).toBe(Math.round((lineB.netCents * 1000) / 10000));
    expect(o.totalCents).toBe(120_000 - 400 - 2_392 + o.surchargeCents + 2_500);
    // tributo interno não entra no total e fica visível apenas ao admin
    const adminView = await admin.get(`/api/admin/orders/${o.id}`);
    expect(adminView.body.internalTaxCents).toBeGreaterThan(0);
    expect(adminView.body.costCents).toBe(2 * 6_000 + 70_000);
    expect(adminView.body.calcSnapshot.steps.length).toBeGreaterThan(2);
  });

  it('aplica o limite de desconto do vendedor (5%) e não confirma automaticamente acima dele', async () => {
    const r = await victor.post('/api/seller/orders', orderBody({ generalDiscountBps: 800 }));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('DISCOUNT_LIMIT');
    expect(await prisma.order.count()).toBe(0);
    // desconto combinado (item + geral) também é verificado
    const r2 = await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p1, quantity: 1, discountBps: 500 }], generalDiscountBps: 100 }));
    expect(r2.status).toBe(422);
  });

  it('rejeita descontos negativos, acima de 100% e quantidades inválidas', async () => {
    expect((await victor.post('/api/seller/orders', orderBody({ generalDiscountBps: -1 }))).status).toBe(400);
    expect((await victor.post('/api/seller/orders', orderBody({ generalDiscountBps: 10_001 }))).status).toBe(400);
    expect((await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p1, quantity: 0 }] }))).status).toBe(400);
    expect((await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p1, quantity: 1.5 }] }))).status).toBe(400);
    expect((await victor.post('/api/seller/orders', orderBody({ items: [] }))).status).toBe(400);
  });

  it('desconto excepcional: solicita aprovação, administrador aprova, tudo registrado', async () => {
    const r = await victor.post('/api/seller/orders', orderBody({ action: 'REQUEST_APPROVAL', generalDiscountBps: 1200, discountReason: 'Cliente novo, volume alto' }));
    expect(r.status).toBe(201);
    expect(r.body.order.status).toBe('PENDING_APPROVAL');
    expect(r.body.order.discountApprovalStatus).toBe('PENDING');
    const admin = await loginAdmin(app);
    const list = await admin.get('/api/admin/approvals?status=PENDING');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].reason).toBe('Cliente novo, volume alto');
    // admin não consegue pular a aprovação mudando o status
    const skip = await admin.post(`/api/admin/orders/${r.body.order.id}/status`, { status: 'APPROVED' });
    expect(skip.status).toBe(422);
    const d = await admin.post(`/api/admin/approvals/${list.body.items[0].id}/decide`, { decision: 'APPROVED', note: 'Ok, exceção' });
    expect(d.status).toBe(200);
    const after = await victor.get(`/api/seller/orders/${r.body.order.id}`);
    expect(after.body.status).toBe('APPROVED');
    expect(after.body.discountApprovalStatus).toBe('APPROVED');
    expect(after.body.approvals[0].decidedByName).toBe('Admin Teste');
    // decisão não pode ser repetida
    expect((await admin.post(`/api/admin/approvals/${list.body.items[0].id}/decide`, { decision: 'REJECTED' })).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: { in: ['DISCOUNT_APPROVAL_REQUESTED', 'DISCOUNT_APPROVED'] } } })).toBe(2);
  });

  it('desconto reprovado devolve o pedido ao vendedor para ajuste (mantendo número e histórico)', async () => {
    const r = await victor.post('/api/seller/orders', orderBody({ action: 'REQUEST_APPROVAL', generalDiscountBps: 1500 }));
    const admin = await loginAdmin(app);
    const ap = await prisma.discountApproval.findFirstOrThrow();
    await admin.post(`/api/admin/approvals/${ap.id}/decide`, { decision: 'REJECTED', note: 'Máximo 5%' });
    const o = await victor.get(`/api/seller/orders/${r.body.order.id}`);
    expect(o.body.status).toBe('DRAFT');
    expect(o.body.number).toBe(r.body.order.number);
    // vendedor ajusta e confirma dentro do limite
    const c = await victor.put(`/api/seller/orders/${r.body.order.id}`, orderBody({ idempotencyKey: key(), generalDiscountBps: 500 }));
    expect(c.status).toBe(200);
    expect(c.body.order.status).toBe('CREATED');
    expect(c.body.order.number).toBe(r.body.order.number);
    expect(await prisma.order.count()).toBe(1);
  });

  it('rascunho: salva, edita e confirma com a mesma chave sem duplicar', async () => {
    const k = key();
    const d = await victor.post('/api/seller/orders', orderBody({ idempotencyKey: k, action: 'DRAFT' }));
    expect(d.status).toBe(201);
    expect(d.body.order.status).toBe('DRAFT');
    expect(d.body.order.number).toBeNull();
    const c = await victor.post('/api/seller/orders', orderBody({ idempotencyKey: k, action: 'CONFIRM', items: [{ productId: fx.p1, quantity: 10 }] }));
    expect(c.body.order.id).toBe(d.body.order.id);
    expect(c.body.order.status).toBe('CREATED');
    expect(c.body.order.totalCents).toBe(100_000);
    expect(await prisma.order.count()).toBe(1);
  });

  it('reenvio da confirmação (ex.: falha de rede) não duplica o pedido', async () => {
    const body = orderBody();
    const first = await victor.post('/api/seller/orders', body);
    const again = await victor.post('/api/seller/orders', body);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.order.id).toBe(first.body.order.id);
    // requisições simultâneas com a mesma chave
    const body2 = orderBody();
    const results = await Promise.all([victor.post('/api/seller/orders', body2), victor.post('/api/seller/orders', body2), victor.post('/api/seller/orders', body2)]);
    expect(new Set(results.map((r) => r.body.order?.id)).size).toBe(1);
    expect(await prisma.order.count()).toBe(2);
  });

  it('numeração única e sequencial mesmo com pedidos simultâneos', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => victor.post('/api/seller/orders', orderBody())));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.order.number);
    expect(new Set(numbers).size).toBe(8);
  });

  it('não permite cliente inativo/pendente, produto inativo nem cliente de outro vendedor', async () => {
    expect((await victor.post('/api/seller/orders', orderBody({ clientId: fx.clientPending }))).body.error).toBe('CLIENT_NOT_ACTIVE');
    expect((await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.inactiveProduct, quantity: 1 }] }))).body.error).toBe('PRODUCT_INACTIVE');
    expect((await victor.post('/api/seller/orders', orderBody({ clientId: fx.clientAna }))).status).toBe(404);
  });

  it('mesmo SKU adicionado duas vezes vira uma única linha com a soma das quantidades', async () => {
    const r = await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p1, quantity: 2 }, { productId: fx.p1, quantity: 3 }] }));
    expect(r.body.order.items).toHaveLength(1);
    expect(r.body.order.items[0].quantity).toBe(5);
  });

  it('consulta de pedidos por período, número, valor, status, marca e produto, com ordenação', async () => {
    await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p1, quantity: 1 }] }));
    await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p3, quantity: 2 }] }));
    const old = await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p2, quantity: 1 }] }));
    await prisma.order.update({ where: { id: old.body.order.id }, data: { orderDate: new Date('2025-01-15T00:00:00Z') } });
    const today = (await victor.get('/api/seller/config')).body.today;

    let r = await victor.get(`/api/seller/orders?from=${today}&to=${today}`);
    expect(r.body.total).toBe(2);
    r = await victor.get('/api/seller/orders?from=2025-01-01&to=2025-01-31');
    expect(r.body.total).toBe(1);
    r = await victor.get('/api/seller/orders?minCents=50000');
    expect(r.body.items.map((o: any) => o.totalCents)).toEqual([200_000]);
    r = await victor.get(`/api/seller/orders?brandId=${fx.brandA}`);
    expect(r.body.total).toBe(2);
    r = await victor.get(`/api/seller/orders?productId=${fx.p3}`);
    expect(r.body.total).toBe(1);
    r = await victor.get('/api/seller/orders?sort=total_asc');
    expect(r.body.items.map((o: any) => o.totalCents)).toEqual([2_550, 10_000, 200_000]);
    r = await victor.get(`/api/seller/orders?number=${old.body.order.number}`);
    expect(r.body.total).toBe(1);
    r = await victor.get('/api/seller/orders?status=CREATED&cnpj=11.222.333');
    expect(r.body.total).toBe(3);
  });

  it('duplicar pedido gera rascunho com preços atuais', async () => {
    const o = await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p1, quantity: 2 }] }));
    await prisma.product.update({ where: { id: fx.p1 }, data: { priceCents: 11_000 } });
    const d = await victor.post(`/api/seller/orders/${o.body.order.id}/duplicate`, { idempotencyKey: key() });
    expect(d.status).toBe(201);
    expect(d.body.order.status).toBe('DRAFT');
    expect(d.body.order.totalCents).toBe(22_000);
  });
});

describe('Andamento do pedido (status)', () => {
  it('histórico de alteração de status registra anterior, novo, data, usuário e observação', async () => {
    const o = (await victor.post('/api/seller/orders', orderBody())).body.order;
    const admin = await loginAdmin(app);
    for (const s of ['APPROVED', 'AWAITING_PICKING', 'PICKING', 'AWAITING_SHIPMENT', 'SHIPPED']) {
      const r = await admin.post(`/api/admin/orders/${o.id}/status`, { status: s, note: `Mudança para ${s}` });
      expect(r.status).toBe(200);
    }
    const h = await victor.get(`/api/seller/orders/${o.id}/history`);
    expect(h.body.status.map((x: any) => x.toStatus)).toEqual(['CREATED', 'APPROVED', 'AWAITING_PICKING', 'PICKING', 'AWAITING_SHIPMENT', 'SHIPPED']);
    const last = h.body.status.at(-1);
    expect(last.fromStatus).toBe('AWAITING_SHIPMENT');
    expect(last.user.name).toBe('Admin Teste');
    expect(last.note).toBe('Mudança para SHIPPED');
    expect(last.createdAt).toBeTruthy();
    // histórico é imutável no banco
    await expect(prisma.orderStatusHistory.updateMany({ data: { note: 'hack' } })).rejects.toThrow();
  });

  it('transições não configuradas são recusadas e vendedor não altera status', async () => {
    const o = (await victor.post('/api/seller/orders', orderBody())).body.order;
    const admin = await loginAdmin(app);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { status: 'DELIVERED' })).body.error).toBe('TRANSITION_NOT_ALLOWED');
    expect((await victor.post(`/api/admin/orders/${o.id}/status`, { status: 'APPROVED' })).status).toBe(403);
  });

  it('pedido cancelado ou concluído não reabre sem ação administrativa justificada', async () => {
    const o = (await victor.post('/api/seller/orders', orderBody())).body.order;
    const admin = await loginAdmin(app);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { status: 'CANCELLED' })).status).toBe(422); // exige motivo
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { status: 'CANCELLED', note: 'Cliente desistiu' })).status).toBe(200);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { status: 'APPROVED' })).body.error).toBe('ORDER_LOCKED');
    expect((await admin.post(`/api/admin/orders/${o.id}/reopen`, { status: 'CREATED', note: 'curto' })).status).toBe(400);
    const re = await admin.post(`/api/admin/orders/${o.id}/reopen`, { status: 'CREATED', note: 'Cliente voltou atrás e confirmou a compra' });
    expect(re.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'ORDER_REOPENED' } })).toBe(1);
  });

  it('estoque (quando habilitado): reserva na aprovação, baixa no envio, sem baixa duplicada; orçamento não movimenta', async () => {
    await prisma.companySettings.update({ where: { id: 1 }, data: { stockEnabled: true, stockPolicy: 'ON_APPROVAL' } });
    await victor.post('/api/seller/quotes', { idempotencyKey: key(), clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 5 }] });
    expect(await prisma.stockMovement.count()).toBe(0);
    const o = (await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p1, quantity: 5 }] }))).body.order;
    const admin = await loginAdmin(app);
    await admin.post(`/api/admin/orders/${o.id}/status`, { status: 'APPROVED' });
    let p = await prisma.product.findUniqueOrThrow({ where: { id: fx.p1 } });
    expect(p.reservedQty).toBe(5);
    expect(p.stockQty).toBe(50);
    for (const s of ['AWAITING_PICKING', 'PICKING', 'AWAITING_SHIPMENT', 'SHIPPED']) await admin.post(`/api/admin/orders/${o.id}/status`, { status: s });
    p = await prisma.product.findUniqueOrThrow({ where: { id: fx.p1 } });
    expect(p.reservedQty).toBe(0);
    expect(p.stockQty).toBe(45);
    // reabrir e reenviar não gera baixa duplicada
    await admin.post(`/api/admin/orders/${o.id}/status`, { status: 'DELIVERED' });
    await admin.post(`/api/admin/orders/${o.id}/status`, { status: 'COMPLETED' });
    await admin.post(`/api/admin/orders/${o.id}/reopen`, { status: 'SHIPPED', note: 'Correção de lançamento do envio' });
    p = await prisma.product.findUniqueOrThrow({ where: { id: fx.p1 } });
    expect(p.stockQty).toBe(45);
    expect(await prisma.stockMovement.count({ where: { orderId: o.id, type: 'OUT' } })).toBe(1);
  });

  it('estoque insuficiente bloqueia a confirmação quando a política exige', async () => {
    await prisma.companySettings.update({ where: { id: 1 }, data: { stockEnabled: true, blockOnInsufficientStock: true } });
    const r = await victor.post('/api/seller/orders', orderBody({ items: [{ productId: fx.p1, quantity: 51 }] }));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('INSUFFICIENT_STOCK');
  });

  it('ajuste manual de estoque exige justificativa e registra o responsável', async () => {
    const admin = await loginAdmin(app);
    expect((await admin.post('/api/admin/stock/adjust', { productId: fx.p1, type: 'ADJUST', quantity: -5, reason: '' })).status).toBe(400);
    const r = await admin.post('/api/admin/stock/adjust', { productId: fx.p1, type: 'ADJUST', quantity: -5, reason: 'Avaria no depósito' });
    expect(r.body.stockQty).toBe(45);
    const m = await prisma.stockMovement.findFirstOrThrow({ include: { user: true } });
    expect(m.user.username).toBe('admin');
    expect((await admin.post('/api/admin/stock/adjust', { productId: fx.p1, type: 'ADJUST', quantity: -1000, reason: 'Teste negativo' })).status).toBe(422);
  });
});
