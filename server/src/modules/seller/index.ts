import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizeCnpj, QUOTE_SELLER_SETTABLE } from '@della/shared';
import { prisma } from '../../db';
import { actor, requireSeller } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import { getSettings, today } from '../../lib/settings';
import { bpsSchema, centsSchema, isoDateOpt, optText, pageArgs, paged, paginationSchema } from '../../lib/validation';
import { clientScopeForRep, docScopeForRep } from '../commercial/access';
import { listSelectClient, orderFilterSchema, orderOrderBy, orderWhere, quoteFilterSchema, quoteOrderBy, quoteWhere } from '../commercial/filters';
import { deleteDraft, duplicateOrder, saveSellerOrder } from '../commercial/orderService';
import { loadRules, priceItems, publicCalc } from '../commercial/pricingService';
import {
  conversionPreview,
  convertQuote,
  duplicateQuote,
  expireQuotes,
  saveSellerQuote,
  setQuoteStatusBySeller,
} from '../commercial/quoteService';
import { orderDetailInclude, quoteDetailInclude, serializeDoc } from '../commercial/serializers';

const idParam = z.object({ id: z.string().uuid() });
const idempotencyKey = z.string().trim().min(8).max(100);

const itemsSchema = z
  .array(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int('A quantidade deve ser um número inteiro.').positive('A quantidade deve ser maior que zero.').max(1_000_000),
      discountBps: bpsSchema.default(0),
      saleUnit: z.enum(['UN', 'CX']).default('UN'),
    }),
  )
  .min(1, 'Adicione pelo menos um produto.')
  .max(300);

const docSchema = z.object({
  clientId: z.string().uuid(),
  items: itemsSchema,
  generalDiscountBps: bpsSchema.default(0),
  freightCents: centsSchema.default(0),
  paymentTermId: z.string().uuid().nullish().transform((v) => v ?? null),
  notes: optText(2000),
  expectedDelivery: isoDateOpt,
});

const orderSaveSchema = docSchema.extend({
  idempotencyKey,
  action: z.enum(['DRAFT', 'CONFIRM', 'REQUEST_APPROVAL']),
  discountReason: optText(500),
});

const quoteSaveSchema = docSchema.extend({
  idempotencyKey,
  validUntil: isoDateOpt,
  requestApproval: z.boolean().default(false),
  discountReason: optText(500),
});

function act(req: FastifyRequest) {
  return { ...actor(req), userId: req.user!.id };
}

/** Remove dados que o vendedor não pode ver, conforme as permissões do cadastro dele. */
function sellerView(req: FastifyRequest, doc: Record<string, unknown>) {
  const rep = req.rep!;
  const out = serializeDoc(doc, rep.canViewCost);
  const client = out.client as Record<string, unknown> | undefined;
  if (client && !rep.canViewFinanceContact) out.client = { ...client, financeEmail: undefined };
  if (Array.isArray(out.approvals)) {
    out.approvals = (out.approvals as Record<string, unknown>[]).map(({ decidedBy, ...a }) => ({ ...a, decidedByName: (decidedBy as { name?: string } | null)?.name ?? null }));
  }
  out.readOnly = doc.salesRepId !== rep.id;
  return out;
}

async function loadOrderForSeller(req: FastifyRequest, id: string) {
  const o = await prisma.order.findFirst({ where: { id, ...docScopeForRep(req.rep!) }, include: orderDetailInclude });
  if (!o) throw notFound('Pedido');
  return sellerView(req, o as unknown as Record<string, unknown>);
}

async function loadQuoteForSeller(req: FastifyRequest, id: string) {
  const q = await prisma.quote.findFirst({ where: { id, ...docScopeForRep(req.rep!) }, include: quoteDetailInclude });
  if (!q) throw notFound('Orçamento');
  return sellerView(req, q as unknown as Record<string, unknown>);
}

/** Rotas /api/seller/*: somente representantes autenticados; tudo é filtrado pelo vendedor da sessão. */
export async function sellerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireSeller);

  app.get('/config', async (req) => {
    const settings = await getSettings();
    const [paymentTerms, rules] = await Promise.all([
      prisma.paymentTerm.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, days: true } }),
      loadRules(prisma),
    ]);
    return {
      today: today(settings),
      timezone: settings.timezone,
      companyName: settings.companyName,
      quoteValidityDays: settings.quoteValidityDays,
      allowItemDiscount: settings.allowItemDiscount,
      allowSellerFreight: settings.allowSellerFreight,
      stockEnabled: settings.stockEnabled,
      conversionPricePolicy: settings.conversionPricePolicy,
      maxDiscountBps: req.rep!.maxDiscountBps,
      paymentTerms,
      // somente acréscimos cobrados do cliente (regras internas não são expostas)
      surchargeRules: rules.filter((r) => r.kind === 'SURCHARGE'),
    };
  });

  // ---------------- Clientes ----------------
  app.get('/clients', async (req) => {
    const q = paginationSchema.extend({ q: z.string().trim().max(100).optional(), onlyActive: z.string().optional() }).parse(req.query);
    const where = {
      AND: [
        clientScopeForRep(req.rep!),
        q.onlyActive === 'true' ? { status: 'ACTIVE' as const } : {},
        q.q
          ? {
              OR: [
                { legalName: { contains: q.q, mode: 'insensitive' as const } },
                { tradeName: { contains: q.q, mode: 'insensitive' as const } },
                { responsibleName: { contains: q.q, mode: 'insensitive' as const } },
                ...(normalizeCnpj(q.q).length >= 3 ? [{ cnpj: { contains: normalizeCnpj(q.q) } }] : []),
              ],
            }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { legalName: 'asc' },
        select: { id: true, legalName: true, tradeName: true, cnpj: true, responsibleName: true, city: true, state: true, status: true },
        ...pageArgs(q),
      }),
      prisma.client.count({ where }),
    ]);
    // clientes ativos (selecionáveis) primeiro
    items.sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'));
    return paged(items, total, q);
  });

  app.get('/clients/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const rep = req.rep!;
    const c = await prisma.client.findFirst({ where: { id, ...clientScopeForRep(rep) } });
    if (!c) throw notFound('Cliente');
    const scope = { clientId: id, ...docScopeForRep(rep) };
    const [stats, recentOrders, recentQuotes] = await Promise.all([
      prisma.order.aggregate({ where: { ...scope, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] } }, _count: true, _sum: { totalCents: true }, _max: { orderDate: true } }),
      prisma.order.findMany({ where: scope, orderBy: { updatedAt: 'desc' }, take: 5, select: { id: true, number: true, status: true, orderDate: true, totalCents: true } }),
      prisma.quote.findMany({ where: scope, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, number: true, status: true, quoteDate: true, validUntil: true, totalCents: true } }),
    ]);
    return {
      id: c.id,
      legalName: c.legalName,
      tradeName: c.tradeName,
      cnpj: c.cnpj,
      stateRegistration: c.stateRegistration,
      responsibleName: c.responsibleName,
      commercialPhone: c.commercialPhone,
      commercialEmail: c.commercialEmail,
      financeEmail: rep.canViewFinanceContact ? c.financeEmail : undefined,
      financePhone: rep.canViewFinanceContact ? c.financePhone : undefined,
      address: { cep: c.cep, state: c.state, city: c.city, district: c.district, street: c.street, number: c.number, complement: c.complement },
      notes: c.notes,
      status: c.status,
      selectable: c.status === 'ACTIVE',
      stats: {
        orders: stats._count,
        lastOrderDate: stats._max.orderDate?.toISOString().slice(0, 10) ?? null,
        totalCents: rep.canViewClientTotals ? stats._sum.totalCents ?? 0 : undefined,
      },
      recentOrders: recentOrders.map((o) => ({ ...o, orderDate: o.orderDate.toISOString().slice(0, 10) })),
      recentQuotes: recentQuotes.map((q) => ({ ...q, quoteDate: q.quoteDate.toISOString().slice(0, 10), validUntil: q.validUntil.toISOString().slice(0, 10) })),
    };
  });

  // ---------------- Catálogo ----------------
  app.get('/brands', async () =>
    prisma.brand.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } }),
  );
  app.get('/categories', async () => prisma.category.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }));

  app.get('/catalog', async (req) => {
    const q = z
      .object({
        q: z.string().trim().max(100).optional(),
        brandId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        onlyAvailable: z.string().optional(),
      })
      .parse(req.query);
    const settings = await getSettings();
    const rep = req.rep!;
    const products = await prisma.product.findMany({
      where: {
        deletedAt: null,
        active: true,
        brand: { active: true },
        ...(q.brandId ? { brandId: q.brandId } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { sku: { contains: q.q, mode: 'insensitive' } },
                { brand: { name: { contains: q.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: [{ brand: { sortOrder: 'asc' } }, { brand: { name: 'asc' } }, { name: 'asc' }],
      take: 1000,
      // seleção explícita: custo, tributo de referência e observações internas não são lidos
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        unitsPerBox: true,
        description: true,
        priceCents: true,
        stockQty: true,
        reservedQty: true,
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], select: { fileName: true } },
        ...(rep.canViewCost ? { costCents: true } : {}),
      },
    });
    const brands = new Map<string, { id: string; name: string; products: unknown[] }>();
    for (const p of products) {
      const available = settings.stockEnabled ? p.stockQty - p.reservedQty : null;
      if (q.onlyAvailable === 'true' && available !== null && available <= 0) continue;
      const { stockQty: _s, reservedQty: _r, images, ...rest } = p;
      const b = brands.get(p.brand.id) ?? { id: p.brand.id, name: p.brand.name, products: [] };
      b.products.push({ ...rest, imageFileName: images[0]?.fileName ?? null, images: images.map((i) => i.fileName), availableQty: available });
      brands.set(p.brand.id, b);
    }
    return { stockEnabled: settings.stockEnabled, brands: [...brands.values()], total: products.length };
  });

  app.post('/pricing/preview', async (req) => {
    const b = z.object({ items: itemsSchema, generalDiscountBps: bpsSchema.default(0), freightCents: centsSchema.default(0) }).parse(req.body);
    const settings = await getSettings();
    const priced = await priceItems(prisma, { ...b, rep: req.rep!, settings });
    return { calc: publicCalc(priced.calc, req.rep!.canViewCost), check: priced.check };
  });

  // ---------------- Pedidos ----------------
  app.get('/orders', async (req) => {
    const f = orderFilterSchema.parse(req.query);
    const where = { AND: [orderWhere({ ...f, salesRepId: req.rep!.canViewAllOrders ? f.salesRepId : undefined }), docScopeForRep(req.rep!)] };
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: orderOrderBy(f.sort),
        include: { client: listSelectClient, salesRep: { select: { id: true, fullName: true } }, _count: { select: { items: true } } },
        ...pageArgs(f),
      }),
      prisma.order.count({ where }),
    ]);
    return paged(
      items.map((o) => ({ ...serializeDoc(o, req.rep!.canViewCost), readOnly: o.salesRepId !== req.rep!.id })),
      total,
      f,
    );
  });

  app.get('/orders/:id', async (req) => loadOrderForSeller(req, idParam.parse(req.params).id));

  app.post('/orders', async (req, reply) => {
    const body = orderSaveSchema.parse(req.body);
    const res = await saveSellerOrder(req.rep!, act(req), body);
    const order = await loadOrderForSeller(req, res.orderId);
    return reply.status(res.duplicate ? 200 : 201).send({ order, duplicate: res.duplicate, check: res.check });
  });

  app.put('/orders/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = orderSaveSchema.parse(req.body);
    const res = await saveSellerOrder(req.rep!, act(req), { ...body, orderId: id });
    return { order: await loadOrderForSeller(req, res.orderId), duplicate: res.duplicate, check: res.check };
  });

  app.delete('/orders/:id', async (req) => {
    await deleteDraft(req.rep!, actor(req), idParam.parse(req.params).id);
    return { ok: true };
  });

  app.post('/orders/:id/duplicate', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { idempotencyKey: key } = z.object({ idempotencyKey }).parse(req.body);
    const res = await duplicateOrder(req.rep!, act(req), id, key);
    return reply.status(201).send({ order: await loadOrderForSeller(req, res.orderId), skipped: res.skipped });
  });

  app.get('/orders/:id/history', async (req) => {
    const { id } = idParam.parse(req.params);
    const o = await prisma.order.findFirst({ where: { id, ...docScopeForRep(req.rep!) }, select: { id: true } });
    if (!o) throw notFound('Pedido');
    const [status, audits] = await Promise.all([
      prisma.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } }),
      prisma.auditLog.findMany({ where: { entity: 'order', entityId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, action: true, createdAt: true, user: { select: { name: true } } } }),
    ]);
    return { status, audit: audits };
  });

  // ---------------- Orçamentos ----------------
  app.get('/quotes', async (req) => {
    await expireQuotes();
    const f = quoteFilterSchema.parse(req.query);
    const where = { AND: [quoteWhere({ ...f, salesRepId: req.rep!.canViewAllOrders ? f.salesRepId : undefined }), docScopeForRep(req.rep!)] };
    const [items, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        orderBy: quoteOrderBy(f.sort),
        include: { client: listSelectClient, convertedOrder: { select: { id: true, number: true } }, _count: { select: { items: true } } },
        ...pageArgs(f),
      }),
      prisma.quote.count({ where }),
    ]);
    return paged(items.map((q) => ({ ...serializeDoc(q, req.rep!.canViewCost), readOnly: q.salesRepId !== req.rep!.id })), total, f);
  });

  app.get('/quotes/:id', async (req) => {
    await expireQuotes();
    return loadQuoteForSeller(req, idParam.parse(req.params).id);
  });

  app.post('/quotes', async (req, reply) => {
    const body = quoteSaveSchema.parse(req.body);
    const res = await saveSellerQuote(req.rep!, act(req), body);
    return reply.status(res.duplicate ? 200 : 201).send({ quote: await loadQuoteForSeller(req, res.quoteId), duplicate: res.duplicate, check: res.check });
  });

  app.put('/quotes/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = quoteSaveSchema.parse(req.body);
    const res = await saveSellerQuote(req.rep!, act(req), { ...body, quoteId: id });
    return { quote: await loadQuoteForSeller(req, res.quoteId), duplicate: res.duplicate, check: res.check };
  });

  app.post('/quotes/:id/status', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ status: z.enum(QUOTE_SELLER_SETTABLE as [string, ...string[]]), note: z.string().trim().max(500).nullish() }).parse(req.body);
    await setQuoteStatusBySeller(req.rep!, act(req), id, b.status as never, b.note ?? null);
    return loadQuoteForSeller(req, id);
  });

  app.post('/quotes/:id/duplicate', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { idempotencyKey: key } = z.object({ idempotencyKey }).parse(req.body);
    const res = await duplicateQuote(req.rep!, act(req), id, key);
    return reply.status(201).send({ quote: await loadQuoteForSeller(req, res.quoteId), skipped: res.skipped });
  });

  app.get('/quotes/:id/conversion-preview', async (req) => conversionPreview(req.rep!, idParam.parse(req.params).id));

  app.post('/quotes/:id/convert', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({
        idempotencyKey,
        acknowledgePriceChange: z.boolean().default(false),
        paymentTermId: z.string().uuid().nullish(),
        notes: z.string().trim().max(2000).nullish(),
        expectedDelivery: isoDateOpt.optional(),
      })
      .parse(req.body);
    const res = await convertQuote(req.rep!, act(req), id, {
      ...b,
      notes: b.notes === undefined ? undefined : b.notes || null,
    });
    return reply.status(res.duplicate ? 200 : 201).send({ order: await loadOrderForSeller(req, res.orderId), duplicate: res.duplicate });
  });
}
