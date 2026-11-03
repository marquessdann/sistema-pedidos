import type { QuoteStatus, SalesRep } from '@prisma/client';
import { QUOTE_OPEN_STATUSES, QUOTE_STATUS_LABELS, addDays, formatBps, type QuoteStatus as QS } from '@della/shared';
import { prisma, Prisma, type Tx } from '../../db';
import { audit, type AuditActor } from '../../lib/audit';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { nextDocumentNumber } from '../../lib/numbering';
import { getSettings, today } from '../../lib/settings';
import { fromDbDate, toDbDate } from '../../lib/validation';
import { assertClientUsable } from './access';
import { resolvePaymentTerm, type DocFields } from './orderService';
import { approvalCovers, lineKey, maxItemDiscount, priceItems, stockShortages, totalsData } from './pricingService';

type Actor = AuditActor & { userId: string };

export interface SaveQuoteInput extends DocFields {
  idempotencyKey: string;
  validUntil?: string | null;
  requestApproval?: boolean;
  discountReason?: string | null;
  quoteId?: string;
}

const isOpen = (s: QuoteStatus) => (QUOTE_OPEN_STATUSES as readonly string[]).includes(s);

/** Marca como expirados os orçamentos abertos com validade vencida (registra histórico). */
export async function expireQuotes(tz?: string) {
  const settings = await getSettings();
  const todayStr = today(tz ? { timezone: tz } : settings);
  const due = await prisma.quote.findMany({
    where: { status: { in: QUOTE_OPEN_STATUSES as QuoteStatus[] }, validUntil: { lt: toDbDate(todayStr)! } },
    select: { id: true, status: true },
  });
  for (const q of due) {
    await prisma.$transaction(async (tx) => {
      const upd = await tx.quote.updateMany({ where: { id: q.id, status: q.status }, data: { status: 'EXPIRED', version: { increment: 1 } } });
      if (upd.count) {
        await tx.quoteStatusHistory.create({
          data: { quoteId: q.id, fromStatus: q.status, toStatus: 'EXPIRED', note: 'Validade da proposta encerrada.' },
        });
      }
    });
  }
  return due.length;
}

export async function saveSellerQuote(rep: SalesRep, act: Actor, input: SaveQuoteInput) {
  try {
    return await prisma.$transaction((tx) => saveQuoteTx(tx, rep, act, input), { timeout: 20_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && !input.quoteId) {
      const existing = await prisma.quote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing && existing.salesRepId === rep.id) return { quoteId: existing.id, duplicate: true, check: null };
    }
    throw e;
  }
}

async function saveQuoteTx(tx: Tx, rep: SalesRep, act: Actor, input: SaveQuoteInput) {
  const settings = await getSettings(tx);
  const todayStr = today(settings);
  const existing = input.quoteId
    ? await tx.quote.findUnique({ where: { id: input.quoteId } })
    : await tx.quote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (input.quoteId && !existing) throw notFound('Orçamento');
  if (existing && existing.salesRepId !== rep.id) {
    if (input.quoteId) throw notFound('Orçamento');
    throw conflict('Chave de requisição já utilizada.', 'IDEMPOTENCY_CONFLICT');
  }
  if (existing && !input.quoteId) {
    // reenvio da criação: devolve o orçamento existente
    return { quoteId: existing.id, duplicate: true, check: null };
  }
  if (existing) {
    if (!isOpen(existing.status)) {
      throw unprocessable(`Orçamento ${QUOTE_STATUS_LABELS[existing.status].toLowerCase()} não pode ser editado.`, 'QUOTE_LOCKED');
    }
    if (fromDbDate(existing.validUntil)! < todayStr) throw unprocessable('Orçamento fora da validade não pode ser editado.', 'QUOTE_EXPIRED');
  }

  await assertClientUsable(tx, rep, input.clientId, 'quote');
  const term = await resolvePaymentTerm(tx, input.paymentTermId);
  const validUntil = input.validUntil ?? addDays(todayStr, settings.quoteValidityDays);
  if (validUntil < todayStr) throw unprocessable('A validade da proposta não pode estar no passado.', 'INVALID_VALIDITY');

  const priced = await priceItems(tx, {
    items: input.items,
    generalDiscountBps: input.generalDiscountBps,
    freightCents: input.freightCents,
    rep,
    settings,
  });

  // situação da aprovação de desconto
  let approvalStatus: 'NONE' | 'PENDING' | 'APPROVED' = 'NONE';
  if (!priced.check.withinLimit) {
    const lastApproved = existing
      ? await tx.discountApproval.findFirst({ where: { quoteId: existing.id, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' } })
      : null;
    if (lastApproved && approvalCovers(lastApproved, priced.calc)) approvalStatus = 'APPROVED';
    else if (input.requestApproval) approvalStatus = 'PENDING';
    else {
      throw unprocessable(
        `O desconto ultrapassa o seu limite de ${formatBps(rep.maxDiscountBps)}. Reduza o desconto ou solicite aprovação do administrador.`,
        'DISCOUNT_LIMIT',
        { reasons: priced.check.reasons, maxDiscountBps: rep.maxDiscountBps },
      );
    }
  }

  const data = {
    clientId: input.clientId,
    ...term,
    notes: input.notes ?? null,
    expectedDelivery: toDbDate(input.expectedDelivery),
    validUntil: toDbDate(validUntil)!,
    discountApprovalStatus: approvalStatus,
    ...totalsData(priced.calc),
  };

  let quoteId: string;
  if (existing) {
    const upd = await tx.quote.updateMany({
      where: { id: existing.id, version: existing.version, status: existing.status },
      data: { ...data, version: { increment: 1 } },
    });
    if (upd.count === 0) throw conflict('O orçamento foi alterado em outra tela. Recarregue e tente novamente.', 'STALE');
    await tx.quoteItem.deleteMany({ where: { quoteId: existing.id } });
    // solicitações pendentes anteriores perdem efeito quando o orçamento muda
    await tx.discountApproval.updateMany({
      where: { quoteId: existing.id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedAt: new Date(), decisionNote: 'Cancelada automaticamente: orçamento alterado pelo vendedor.' },
    });
    quoteId = existing.id;
    await audit(tx, act, 'QUOTE_UPDATED', 'quote', quoteId, { number: existing.number, totalCents: priced.calc.totalCents });
  } else {
    const number = await nextDocumentNumber(tx, settings.quoteNumberPrefix, parseInt(todayStr.slice(0, 4), 10));
    const created = await tx.quote.create({
      data: {
        ...data,
        number,
        idempotencyKey: input.idempotencyKey,
        salesRepId: rep.id,
        createdById: act.userId,
        quoteDate: toDbDate(todayStr)!,
        status: 'DRAFT',
      },
    });
    quoteId = created.id;
    await tx.quoteStatusHistory.create({ data: { quoteId, fromStatus: null, toStatus: 'DRAFT', userId: act.userId, note: 'Orçamento criado.' } });
    await audit(tx, act, 'QUOTE_CREATED', 'quote', quoteId, { number, totalCents: priced.calc.totalCents });
  }
  await tx.quoteItem.createMany({ data: priced.lines.map((l) => ({ ...l, quoteId })) });

  if (approvalStatus === 'PENDING') {
    const approval = await tx.discountApproval.create({
      data: {
        quoteId,
        salesRepId: rep.id,
        requestedBps: priced.calc.effectiveDiscountBps,
        generalDiscountBps: priced.calc.generalDiscountBps,
        maxItemDiscountBps: maxItemDiscount(priced.calc),
        maxAllowedBps: rep.maxDiscountBps,
        totalCents: priced.calc.totalCents,
        reason: input.discountReason ?? null,
      },
    });
    await audit(tx, act, 'DISCOUNT_APPROVAL_REQUESTED', 'quote', quoteId, { approvalId: approval.id, requestedBps: approval.requestedBps });
  }
  return { quoteId, duplicate: false, check: priced.check };
}

/** Status que o vendedor pode registrar manualmente (ex.: enviado ao cliente, aprovado pelo cliente). */
export async function setQuoteStatusBySeller(rep: SalesRep, act: Actor, quoteId: string, to: QS, note: string | null) {
  return prisma.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const q = await tx.quote.findFirst({ where: { id: quoteId, salesRepId: rep.id } });
    if (!q) throw notFound('Orçamento');
    if (!isOpen(q.status)) throw unprocessable(`Orçamento ${QUOTE_STATUS_LABELS[q.status].toLowerCase()} não pode mudar de status.`, 'QUOTE_LOCKED');
    if (fromDbDate(q.validUntil)! < today(settings) && to !== 'REJECTED') throw unprocessable('Orçamento fora da validade.', 'QUOTE_EXPIRED');
    if (q.discountApprovalStatus === 'PENDING' && ['SENT', 'AWAITING_RESPONSE', 'APPROVED_BY_CLIENT'].includes(to)) {
      throw unprocessable('Aguarde a aprovação do desconto antes de enviar o orçamento ao cliente.', 'APPROVAL_PENDING');
    }
    if (q.status === to) return { from: q.status, to };
    const upd = await tx.quote.updateMany({ where: { id: quoteId, status: q.status }, data: { status: to as QuoteStatus, version: { increment: 1 } } });
    if (!upd.count) throw conflict('O orçamento foi alterado. Recarregue a página.', 'STALE');
    await tx.quoteStatusHistory.create({ data: { quoteId, fromStatus: q.status, toStatus: to as QuoteStatus, userId: act.userId, note } });
    await audit(tx, act, 'QUOTE_STATUS_CHANGED', 'quote', quoteId, { number: q.number, from: q.status, to, note });
    return { from: q.status, to };
  });
}

/** Verifica se o orçamento pode ser convertido e compara preços do orçamento x catálogo atual. */
export async function conversionPreview(rep: SalesRep, quoteId: string) {
  const settings = await getSettings();
  const q = await prisma.quote.findFirst({
    where: { id: quoteId, salesRepId: rep.id },
    include: { items: { orderBy: { position: 'asc' }, include: { product: { include: { brand: true } } } }, client: true },
  });
  if (!q) throw notFound('Orçamento');
  const blockers: string[] = [];
  const todayStr = today(settings);
  if (q.status === 'CONVERTED') blockers.push('Este orçamento já foi convertido em pedido.');
  else if (!isOpen(q.status)) blockers.push(`Orçamento com status "${QUOTE_STATUS_LABELS[q.status]}" não pode ser convertido.`);
  if (fromDbDate(q.validUntil)! < todayStr && q.status !== 'CONVERTED') blockers.push('A validade do orçamento expirou.');
  if (q.discountApprovalStatus === 'PENDING') blockers.push('O desconto deste orçamento ainda aguarda aprovação.');
  if (q.client.status === 'UNDER_REVIEW' || q.client.status === 'PENDING_REGISTRATION') {
    blockers.push('O cadastro do cliente ainda aguarda aprovação do administrador. Depois da aprovação o orçamento poderá virar pedido.');
  } else if (q.client.status !== 'ACTIVE') blockers.push('O cliente não está ativo.');
  const items = q.items.map((i) => {
    const active = i.product.active && !i.product.deletedAt && i.product.brand.active;
    if (!active) blockers.push(`O produto ${i.sku} – ${i.productName} está inativo. Edite o orçamento e remova-o.`);
    const isBox = i.saleUnit === 'CX';
    if (isBox && (!i.product.unitsPerBox || i.product.unitsPerBox < 2)) {
      blockers.push(`O produto ${i.sku} – ${i.productName} não é mais vendido por caixa. Edite o orçamento.`);
    }
    const currentPriceCents = i.product.priceCents * (isBox ? i.product.unitsPerBox ?? 1 : 1);
    return {
      productId: i.productId,
      sku: i.sku,
      productName: i.productName,
      brandName: i.brandName,
      saleUnit: i.saleUnit,
      unit: i.unit,
      unitsPerSaleUnit: i.unitsPerSaleUnit,
      quantity: i.quantity,
      discountBps: i.discountBps,
      quotePriceCents: i.unitPriceCents,
      currentPriceCents,
      priceChanged: currentPriceCents !== i.unitPriceCents,
      active,
    };
  });
  return {
    quoteId: q.id,
    number: q.number,
    canConvert: blockers.length === 0,
    blockers,
    pricePolicy: settings.conversionPricePolicy,
    priceChanged: items.some((i) => i.priceChanged),
    items,
    quoteTotalCents: q.totalCents,
    generalDiscountBps: q.generalDiscountBps,
    freightCents: q.freightCents,
    paymentTermId: q.paymentTermId,
    notes: q.notes,
    expectedDelivery: fromDbDate(q.expectedDelivery),
  };
}

export interface ConvertInput {
  idempotencyKey: string;
  acknowledgePriceChange: boolean;
  paymentTermId?: string | null;
  notes?: string | null;
  expectedDelivery?: string | null;
}

/**
 * Converte orçamento em pedido. Atômico: o orçamento é marcado como CONVERTIDO com um UPDATE condicional
 * na mesma transação que cria o pedido. Duas conversões simultâneas nunca geram dois pedidos.
 */
export async function convertQuote(rep: SalesRep, act: Actor, quoteId: string, input: ConvertInput) {
  // reenvio da mesma requisição: devolve o pedido já criado
  const replay = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.salesRepId !== rep.id || replay.quoteId !== quoteId) throw conflict('Chave de requisição já utilizada.', 'IDEMPOTENCY_CONFLICT');
    return { orderId: replay.id, duplicate: true };
  }
  const preview = await conversionPreview(rep, quoteId);
  if (preview.priceChanged && !input.acknowledgePriceChange) {
    throw unprocessable('Os preços de alguns produtos mudaram desde o orçamento. Revise e confirme para continuar.', 'PRICE_CHANGED', {
      items: preview.items.filter((i) => i.priceChanged),
      policy: preview.pricePolicy,
    });
  }
  if (!preview.canConvert) {
    const already = preview.blockers.some((b) => b.includes('já foi convertido'));
    throw new AppError(already ? 409 : 422, preview.blockers.join(' '), already ? 'ALREADY_CONVERTED' : 'CANNOT_CONVERT', { blockers: preview.blockers });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const settings = await getSettings(tx);
      const q = await tx.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { items: true } });
      await assertClientUsable(tx, rep, q.clientId);

      // 1) trava a linha do orçamento (SELECT ... FOR UPDATE): conversões simultâneas esperam aqui
      //    e, ao prosseguir, encontram o orçamento já convertido.
      const locked = await tx.$queryRaw<{ status: string; convertedOrderId: string | null }[]>`
        SELECT status::text AS status, "convertedOrderId" FROM quotes WHERE id = ${quoteId}::uuid FOR UPDATE`;
      if (!locked.length || locked[0].convertedOrderId || !(QUOTE_OPEN_STATUSES as readonly string[]).includes(locked[0].status)) {
        throw conflict('Este orçamento já foi convertido em pedido.', 'ALREADY_CONVERTED');
      }

      const keepPrices = settings.conversionPricePolicy === 'KEEP_QUOTE_PRICES';
      const priced = await priceItems(tx, {
        items: q.items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountBps: i.discountBps, saleUnit: i.saleUnit as 'UN' | 'CX' })),
        generalDiscountBps: q.generalDiscountBps,
        freightCents: q.freightCents,
        rep,
        // a regra de frete/desconto por item já foi aplicada no orçamento aprovado
        settings: { ...settings, allowItemDiscount: true, allowSellerFreight: true },
        priceOverrides: keepPrices ? new Map(q.items.map((i) => [lineKey(i.productId, i.saleUnit as 'UN' | 'CX'), i.unitPriceCents])) : undefined,
      });

      // o desconto precisa estar dentro do limite ou coberto pela aprovação do orçamento
      let approvalStatus: 'NONE' | 'APPROVED' = 'NONE';
      if (!priced.check.withinLimit) {
        const approved = await tx.discountApproval.findFirst({ where: { quoteId, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' } });
        if (!approved || !approvalCovers(approved, priced.calc)) {
          throw unprocessable('O desconto do orçamento ultrapassa o seu limite e não possui aprovação.', 'DISCOUNT_LIMIT', { reasons: priced.check.reasons });
        }
        approvalStatus = 'APPROVED';
      }
      if (settings.stockEnabled && settings.blockOnInsufficientStock) {
        const short = stockShortages(priced);
        if (short.length) {
          throw unprocessable(`Estoque insuficiente: ${short.map((s) => `${s.sku} (disponível ${s.available})`).join('; ')}.`, 'INSUFFICIENT_STOCK', { shortages: short });
        }
      }

      const term = await resolvePaymentTerm(tx, input.paymentTermId === undefined ? q.paymentTermId : input.paymentTermId);
      const todayStr = today(settings);
      const number = await nextDocumentNumber(tx, settings.orderNumberPrefix, parseInt(todayStr.slice(0, 4), 10));
      const order = await tx.order.create({
        data: {
          number,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
          clientId: q.clientId,
          salesRepId: rep.id,
          quoteId,
          orderDate: toDbDate(todayStr)!,
          expectedDelivery: toDbDate(input.expectedDelivery === undefined ? fromDbDate(q.expectedDelivery) : input.expectedDelivery),
          ...term,
          notes: input.notes === undefined ? q.notes : input.notes,
          ...totalsData(priced.calc),
          discountApprovalStatus: approvalStatus,
          confirmedAt: new Date(),
          createdById: act.userId,
          items: { createMany: { data: priced.lines } },
        },
      });
      // 2) marca como convertido e vincula o pedido no mesmo UPDATE (condicional, por segurança)
      const mark = await tx.quote.updateMany({
        where: { id: quoteId, convertedOrderId: null, status: { in: QUOTE_OPEN_STATUSES as QuoteStatus[] } },
        data: { status: 'CONVERTED', convertedOrderId: order.id, convertedAt: new Date(), version: { increment: 1 } },
      });
      if (mark.count === 0) throw conflict('Este orçamento já foi convertido em pedido.', 'ALREADY_CONVERTED');
      await tx.quoteStatusHistory.create({
        data: { quoteId, fromStatus: q.status, toStatus: 'CONVERTED', userId: act.userId, note: `Convertido no pedido ${number}.` },
      });
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus: null, toStatus: 'CREATED', userId: act.userId, note: `Pedido gerado a partir do orçamento ${q.number}.` },
      });
      await audit(tx, act, 'QUOTE_CONVERTED', 'quote', quoteId, {
        quoteNumber: q.number,
        orderId: order.id,
        orderNumber: number,
        pricePolicy: settings.conversionPricePolicy,
        priceChanged: preview.priceChanged,
        quoteTotalCents: q.totalCents,
        orderTotalCents: priced.calc.totalCents,
      });
      return { orderId: order.id, duplicate: false };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { orderId: existing.id, duplicate: true };
      throw conflict('Este orçamento já foi convertido em pedido.', 'ALREADY_CONVERTED');
    }
    throw e;
  }
}

/**
 * Ação administrativa controlada: libera um orçamento convertido para nova conversão.
 * Exige que o pedido gerado anteriormente esteja cancelado ou reprovado, e uma justificativa.
 */
export async function allowReconversion(act: Actor, quoteId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id: quoteId }, include: { convertedOrder: true } });
    if (!q) throw notFound('Orçamento');
    if (q.status !== 'CONVERTED' || !q.convertedOrder) throw unprocessable('O orçamento não está convertido.');
    if (!['CANCELLED', 'REJECTED'].includes(q.convertedOrder.status)) {
      throw unprocessable(`O pedido ${q.convertedOrder.number} precisa estar cancelado ou reprovado antes de liberar nova conversão.`);
    }
    if (reason.trim().length < 10) throw unprocessable('Informe uma justificativa com pelo menos 10 caracteres.');
    await tx.quote.update({
      where: { id: quoteId },
      data: { status: 'APPROVED_BY_CLIENT', convertedOrderId: null, convertedAt: null, version: { increment: 1 } },
    });
    await tx.quoteStatusHistory.create({
      data: { quoteId, fromStatus: 'CONVERTED', toStatus: 'APPROVED_BY_CLIENT', userId: act.userId, note: `Nova conversão liberada pelo administrador: ${reason}` },
    });
    await audit(tx, act, 'QUOTE_RECONVERSION_ALLOWED', 'quote', quoteId, { number: q.number, previousOrder: q.convertedOrder.number, reason });
  });
}

export async function duplicateQuote(rep: SalesRep, act: Actor, sourceId: string, idempotencyKey: string) {
  const source = await prisma.quote.findFirst({ where: { id: sourceId, salesRepId: rep.id }, include: { items: true } });
  if (!source) throw notFound('Orçamento');
  const active = await prisma.product.findMany({
    where: { id: { in: source.items.map((i) => i.productId) }, active: true, deletedAt: null, brand: { active: true } },
    select: { id: true },
  });
  const ids = new Set(active.map((p) => p.id));
  const items = source.items
    .filter((i) => ids.has(i.productId))
    .map((i) => ({ productId: i.productId, quantity: i.quantity, discountBps: i.discountBps, saleUnit: i.saleUnit as 'UN' | 'CX' }));
  if (!items.length) throw unprocessable('Nenhum produto deste orçamento está ativo no catálogo.');
  const res = await saveSellerQuote(rep, act, {
    idempotencyKey,
    clientId: source.clientId,
    items,
    generalDiscountBps: source.generalDiscountBps,
    freightCents: source.freightCents,
    paymentTermId: source.paymentTermId,
    notes: source.notes,
    expectedDelivery: null,
    validUntil: null,
    requestApproval: true,
  });
  await audit(prisma, act, 'QUOTE_DUPLICATED', 'quote', res.quoteId, { sourceQuoteId: sourceId });
  return { ...res, skipped: source.items.length - items.length };
}

export { assertClientUsable };
