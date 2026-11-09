import type { OrderStatus, SalesRep } from '@prisma/client';
import { ORDER_PROGRESS_STEPS, ORDER_STATUS_LABELS, ORDER_TERMINAL_STATUSES, formatBps, orderProgressLevel } from '@della/shared';
import { prisma, Prisma, type Tx } from '../../db';
import { audit, type AuditActor } from '../../lib/audit';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { nextDocumentNumber } from '../../lib/numbering';
import { getSettings, today } from '../../lib/settings';
import { toDbDate } from '../../lib/validation';
import { assertClientUsable } from './access';
import { maxItemDiscount, priceItems, stockShortages, totalsData, type LineInput } from './pricingService';
import { applyStockForStatus } from './stockService';

export type SaveAction = 'DRAFT' | 'CONFIRM' | 'REQUEST_APPROVAL';

export interface DocFields {
  clientId: string;
  items: LineInput[];
  generalDiscountBps: number;
  freightCents: number;
  paymentTermId?: string | null;
  notes?: string | null;
  expectedDelivery?: string | null;
}

export interface SaveOrderInput extends DocFields {
  idempotencyKey: string;
  action: SaveAction;
  discountReason?: string | null;
  orderId?: string;
}

export async function resolvePaymentTerm(tx: Tx, id: string | null | undefined) {
  if (!id) return { paymentTermId: null, paymentTermName: null, paymentDays: null };
  const t = await tx.paymentTerm.findUnique({ where: { id } });
  if (!t || !t.active) throw unprocessable('Condição de pagamento inválida ou inativa.', 'PAYMENT_TERM_INVALID');
  return { paymentTermId: t.id, paymentTermName: t.name, paymentDays: t.days };
}

/**
 * Salva um pedido do vendedor (rascunho, confirmação ou solicitação de aprovação).
 * Idempotente: a mesma `idempotencyKey` nunca gera dois pedidos. Reenvios de um pedido já
 * confirmado retornam o pedido existente com `duplicate: true`.
 */
export async function saveSellerOrder(rep: SalesRep, act: AuditActor & { userId: string }, input: SaveOrderInput) {
  try {
    return await prisma.$transaction((tx) => saveOrderTx(tx, rep, act, input), { isolationLevel: 'ReadCommitted', timeout: 20_000 });
  } catch (e) {
    // corrida entre duas requisições com a mesma chave: devolve o pedido já criado
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && !input.orderId) {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing && existing.salesRepId === rep.id) return { orderId: existing.id, duplicate: true, check: null };
    }
    throw e;
  }
}

async function saveOrderTx(tx: Tx, rep: SalesRep, act: AuditActor & { userId: string }, input: SaveOrderInput) {
  const settings = await getSettings(tx);
  const existing = input.orderId
    ? await tx.order.findUnique({ where: { id: input.orderId } })
    : await tx.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });

  if (input.orderId && !existing) throw notFound('Pedido');
  if (existing && existing.salesRepId !== rep.id) {
    if (input.orderId) throw notFound('Pedido');
    throw conflict('Chave de requisição já utilizada.', 'IDEMPOTENCY_CONFLICT');
  }
  if (existing && existing.status !== 'DRAFT') {
    // pedido já registrado: não altera nem duplica
    return { orderId: existing.id, duplicate: true, check: null };
  }

  await assertClientUsable(tx, rep, input.clientId);
  const term = await resolvePaymentTerm(tx, input.paymentTermId);
  const priced = await priceItems(tx, {
    items: input.items,
    generalDiscountBps: input.generalDiscountBps,
    freightCents: input.freightCents,
    rep,
    settings,
  });

  let action = input.action;
  if (action === 'REQUEST_APPROVAL' && priced.check.withinLimit) action = 'CONFIRM';
  if (action === 'CONFIRM' && !priced.check.withinLimit) {
    throw unprocessable(
      `O desconto ultrapassa o seu limite de ${formatBps(rep.maxDiscountBps)}. Reduza o desconto ou solicite aprovação do administrador.`,
      'DISCOUNT_LIMIT',
      { reasons: priced.check.reasons, maxDiscountBps: rep.maxDiscountBps },
    );
  }
  if (action !== 'DRAFT' && settings.stockEnabled && settings.blockOnInsufficientStock) {
    const short = stockShortages(priced);
    if (short.length) {
      throw unprocessable(
        `Estoque insuficiente: ${short.map((s) => `${s.sku} (disponível ${s.available}, pedido ${s.requested})`).join('; ')}.`,
        'INSUFFICIENT_STOCK',
        { shortages: short },
      );
    }
  }

  const todayStr = today(settings);
  const data = {
    clientId: input.clientId,
    ...term,
    notes: input.notes ?? null,
    expectedDelivery: toDbDate(input.expectedDelivery),
    orderDate: toDbDate(todayStr)!,
    ...totalsData(priced.calc),
  };

  let orderId: string;
  if (existing) {
    // controle de concorrência otimista: só atualiza se ainda for rascunho na mesma versão
    const upd = await tx.order.updateMany({
      where: { id: existing.id, status: 'DRAFT', version: existing.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (upd.count === 0) throw conflict('O pedido foi alterado em outra tela. Recarregue e tente novamente.', 'STALE');
    await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
    orderId = existing.id;
  } else {
    const created = await tx.order.create({
      data: { ...data, idempotencyKey: input.idempotencyKey, salesRepId: rep.id, createdById: act.userId, status: 'DRAFT' },
    });
    orderId = created.id;
    await audit(tx, act, 'ORDER_DRAFT_CREATED', 'order', orderId, { totalCents: priced.calc.totalCents });
  }
  await tx.orderItem.createMany({ data: priced.lines.map((l) => ({ ...l, orderId })) });

  if (action === 'DRAFT') {
    if (existing) await audit(tx, act, 'ORDER_DRAFT_UPDATED', 'order', orderId, { totalCents: priced.calc.totalCents });
    return { orderId, duplicate: false, check: priced.check };
  }

  const year = parseInt(todayStr.slice(0, 4), 10);
  const number = existing?.number ?? (await nextDocumentNumber(tx, settings.orderNumberPrefix, year));
  const toStatus: OrderStatus = action === 'CONFIRM' ? 'CREATED' : 'PENDING_APPROVAL';
  await tx.order.update({
    where: { id: orderId },
    data: {
      number,
      status: toStatus,
      confirmedAt: new Date(),
      discountApprovalStatus: action === 'REQUEST_APPROVAL' ? 'PENDING' : 'NONE',
    },
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId,
      fromStatus: 'DRAFT',
      toStatus,
      userId: act.userId,
      note: action === 'REQUEST_APPROVAL' ? `Desconto acima do limite – aprovação solicitada. ${input.discountReason ?? ''}`.trim() : 'Pedido confirmado pelo vendedor.',
    },
  });
  if (action === 'REQUEST_APPROVAL') {
    const approval = await tx.discountApproval.create({
      data: {
        orderId,
        salesRepId: rep.id,
        requestedBps: priced.calc.effectiveDiscountBps,
        generalDiscountBps: priced.calc.generalDiscountBps,
        maxItemDiscountBps: maxItemDiscount(priced.calc),
        maxAllowedBps: rep.maxDiscountBps,
        totalCents: priced.calc.totalCents,
        reason: input.discountReason ?? null,
      },
    });
    await audit(tx, act, 'DISCOUNT_APPROVAL_REQUESTED', 'order', orderId, {
      approvalId: approval.id,
      number,
      requestedBps: approval.requestedBps,
      maxAllowedBps: rep.maxDiscountBps,
    });
  } else {
    await audit(tx, act, 'ORDER_CONFIRMED', 'order', orderId, { number, totalCents: priced.calc.totalCents });
  }
  return { orderId, duplicate: false, check: priced.check };
}

/** Lista de transições permitidas (configuradas no banco). */
export async function allowedTransitions(tx: Tx | typeof prisma, from: OrderStatus) {
  const rows = await tx.orderStatusTransition.findMany({ where: { fromStatus: from } });
  return rows.map((r) => r.toStatus);
}

/** Alteração de status pelo administrador, respeitando as transições configuradas. */
export async function changeOrderStatus(
  act: AuditActor & { userId: string },
  orderId: string,
  toStatus: OrderStatus,
  note: string | null,
  opts: { reopen?: boolean } = {},
) {
  return prisma.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw notFound('Pedido');
    if (order.status === 'DRAFT') throw unprocessable('Rascunhos não possuem andamento. O vendedor precisa confirmar o pedido.');
    if (order.status === toStatus) throw unprocessable('O pedido já está neste status.');

    if (opts.reopen) {
      if (!ORDER_TERMINAL_STATUSES.includes(order.status)) {
        throw unprocessable('Somente pedidos concluídos, cancelados ou reprovados podem ser reabertos.');
      }
      if (!note || note.trim().length < 10) throw unprocessable('Informe uma justificativa (mínimo 10 caracteres) para reabrir o pedido.');
      if (ORDER_TERMINAL_STATUSES.includes(toStatus)) throw unprocessable('Escolha um status em andamento para reabrir o pedido.');
    } else {
      if (ORDER_TERMINAL_STATUSES.includes(order.status)) {
        throw unprocessable(
          `Pedido ${ORDER_STATUS_LABELS[order.status].toLowerCase()} não pode ser alterado. Use "Reabrir pedido" com justificativa.`,
          'ORDER_LOCKED',
        );
      }
      const allowed = await allowedTransitions(tx, order.status);
      if (!allowed.includes(toStatus)) {
        throw unprocessable(
          `Transição não permitida: ${ORDER_STATUS_LABELS[order.status]} → ${ORDER_STATUS_LABELS[toStatus]}.`,
          'TRANSITION_NOT_ALLOWED',
        );
      }
      if (order.discountApprovalStatus === 'PENDING' && toStatus !== 'CANCELLED') {
        throw unprocessable('Há um desconto aguardando decisão. Aprove ou reprove o desconto em "Aprovações".', 'APPROVAL_PENDING');
      }
      if (toStatus === 'CANCELLED' && (!note || note.trim().length < 3)) {
        throw unprocessable('Informe o motivo do cancelamento.');
      }
    }

    const upd = await tx.order.updateMany({
      where: { id: orderId, status: order.status, version: order.version },
      data: {
        status: toStatus,
        version: { increment: 1 },
        ...(toStatus === 'CANCELLED' ? { cancelReason: note } : {}),
      },
    });
    if (upd.count === 0) throw conflict('O pedido foi alterado por outra pessoa. Recarregue a página.', 'STALE');

    if (order.discountApprovalStatus === 'PENDING' && toStatus === 'CANCELLED') {
      await tx.discountApproval.updateMany({
        where: { orderId, status: 'PENDING' },
        data: { status: 'REJECTED', decidedById: act.userId, decidedAt: new Date(), decisionNote: 'Pedido cancelado.' },
      });
      await tx.order.update({ where: { id: orderId }, data: { discountApprovalStatus: 'REJECTED' } });
    }

    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: order.status, toStatus, userId: act.userId, note: opts.reopen ? `REABERTURA: ${note}` : note },
    });
    await applyStockForStatus(tx, settings, order, toStatus, act.userId);
    await audit(tx, act, opts.reopen ? 'ORDER_REOPENED' : toStatus === 'CANCELLED' ? 'ORDER_CANCELLED' : 'ORDER_STATUS_CHANGED', 'order', orderId, {
      number: order.number,
      from: order.status,
      to: toStatus,
      note,
    });
    return { from: order.status, to: toStatus };
  });
}

/** Caminho mais curto entre dois status usando as transições configuradas (sem passar por cancelado/reprovado). */
async function statusPath(from: OrderStatus, to: OrderStatus): Promise<OrderStatus[] | null> {
  const rows = await prisma.orderStatusTransition.findMany();
  const next = new Map<OrderStatus, OrderStatus[]>();
  for (const r of rows) {
    if (r.toStatus === 'CANCELLED' || r.toStatus === 'REJECTED') continue;
    next.set(r.fromStatus, [...(next.get(r.fromStatus) ?? []), r.toStatus]);
  }
  const prev = new Map<OrderStatus, OrderStatus>();
  const queue: OrderStatus[] = [from];
  const seen = new Set<OrderStatus>([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const n of next.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      queue.push(n);
    }
  }
  if (!seen.has(to)) return null;
  const path: OrderStatus[] = [];
  for (let s: OrderStatus | undefined = to; s && s !== from; s = prev.get(s)) path.unshift(s);
  return path;
}

/**
 * "Chavinhas" de andamento: ligar uma etapa avança o pedido até ela pelas transições configuradas
 * (passando pelas intermediárias); desligar volta para a etapa anterior.
 * A logística só mexe nas etapas dela e só em pedidos já enviados para a logística.
 */
export async function setOrderProgress(
  act: AuditActor & { userId: string },
  orderId: string,
  step: OrderStatus,
  on: boolean,
  opts: { logistics?: boolean } = {},
) {
  const idx = ORDER_PROGRESS_STEPS.findIndex((s) => s.status === step);
  if (idx < 0) throw unprocessable('Etapa inválida.');
  const def = ORDER_PROGRESS_STEPS[idx];
  if (opts.logistics && !def.logistics) throw new AppError(403, 'A logística não pode alterar esta etapa.', 'FORBIDDEN');
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, number: true, version: true } });
  if (!order) throw notFound('Pedido');
  const level = orderProgressLevel(order.status);
  if (level < 0) throw unprocessable(`Pedido ${ORDER_STATUS_LABELS[order.status as OrderStatus].toLowerCase()} não tem andamento.`, 'ORDER_LOCKED');
  if (opts.logistics && level < 3) throw unprocessable('Este pedido ainda não foi enviado para a logística.', 'NOT_IN_LOGISTICS');
  const label = def.label;

  if (on) {
    if (level >= idx + 1) return { status: order.status };
    const path = await statusPath(order.status as OrderStatus, step);
    if (!path) throw unprocessable(`Não foi possível marcar "${label}" a partir de "${ORDER_STATUS_LABELS[order.status as OrderStatus]}".`, 'TRANSITION_NOT_ALLOWED');
    for (const [i, st] of path.entries()) {
      await changeOrderStatus(act, orderId, st, i === path.length - 1 ? `Marcado: ${label}` : null);
    }
    return { status: step };
  }

  // desligar: volta para a etapa anterior
  if (level < idx + 1) return { status: order.status };
  const back: OrderStatus = idx > 0 ? ORDER_PROGRESS_STEPS[idx - 1].status : 'CREATED';
  if (opts.logistics && orderProgressLevel(back) < 3) throw new AppError(403, 'A logística não pode alterar esta etapa.', 'FORBIDDEN');
  await prisma.$transaction(async (tx) => {
    const upd = await tx.order.updateMany({
      where: { id: orderId, status: order.status, version: order.version },
      data: { status: back, version: { increment: 1 } },
    });
    if (upd.count === 0) throw conflict('O pedido foi alterado por outra pessoa. Recarregue a página.', 'STALE');
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: order.status as OrderStatus, toStatus: back, userId: act.userId, note: `Desmarcado: ${label}` },
    });
    await audit(tx, act, 'ORDER_STATUS_REVERTED', 'order', orderId, { number: order.number, from: order.status, to: back, step: label });
  });
  return { status: back };
}

/** Cria um novo rascunho a partir de um pedido existente, com os preços ATUAIS do catálogo. */
export async function duplicateOrder(rep: SalesRep, act: AuditActor & { userId: string }, sourceId: string, idempotencyKey: string) {
  const source = await prisma.order.findFirst({ where: { id: sourceId, salesRepId: rep.id }, include: { items: true } });
  if (!source) throw notFound('Pedido');
  const activeProducts = await prisma.product.findMany({
    where: { id: { in: source.items.map((i) => i.productId) }, active: true, deletedAt: null, brand: { active: true } },
    select: { id: true },
  });
  const activeIds = new Set(activeProducts.map((p) => p.id));
  const items = source.items
    .filter((i) => activeIds.has(i.productId))
    .map((i) => ({ productId: i.productId, quantity: i.quantity, discountBps: i.discountBps, saleUnit: i.saleUnit as 'UN' | 'CX' }));
  if (items.length === 0) throw unprocessable('Nenhum produto deste pedido está ativo no catálogo.');
  const res = await saveSellerOrder(rep, act, {
    idempotencyKey,
    action: 'DRAFT',
    clientId: source.clientId,
    items,
    generalDiscountBps: source.generalDiscountBps,
    freightCents: source.freightCents,
    paymentTermId: source.paymentTermId,
    notes: source.notes,
    expectedDelivery: null,
  });
  await audit(prisma, act, 'ORDER_DUPLICATED', 'order', res.orderId, { sourceOrderId: sourceId, skipped: source.items.length - items.length });
  return { ...res, skipped: source.items.length - items.length };
}

export async function deleteDraft(rep: SalesRep, act: AuditActor, orderId: string) {
  return prisma.$transaction(async (tx) => {
    const o = await tx.order.findFirst({ where: { id: orderId, salesRepId: rep.id } });
    if (!o) throw notFound('Pedido');
    if (o.status !== 'DRAFT') throw new AppError(422, 'Somente rascunhos podem ser excluídos.', 'NOT_DRAFT');
    if (o.number) throw new AppError(422, 'Este rascunho já possui número e histórico; ele não pode ser excluído.', 'HAS_HISTORY');
    await tx.order.delete({ where: { id: orderId } });
    await audit(tx, act, 'ORDER_DRAFT_DELETED', 'order', orderId, { totalCents: o.totalCents });
  });
}
