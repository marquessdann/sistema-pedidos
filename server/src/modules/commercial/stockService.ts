import type { CompanySettings, OrderStatus, StockMovementType } from '@prisma/client';
import type { Tx } from '../../db';
import { unprocessable } from '../../lib/errors';
import { ORDER_DISPATCHED_STATUSES } from '@della/shared';

interface MoveArgs {
  productId: string;
  type: StockMovementType;
  /** variação com sinal no estoque físico */
  stockDelta: number;
  /** variação com sinal na quantidade reservada */
  reservedDelta: number;
  orderId?: string | null;
  reason?: string | null;
  userId: string;
  /** exige saldo suficiente (disponível para reserva / físico para baixa) */
  enforce: boolean;
}

/** Aplica uma movimentação de forma atômica, com checagem de saldo no próprio UPDATE. */
export async function moveStock(tx: Tx, args: MoveArgs) {
  const { productId, stockDelta, reservedDelta } = args;
  // condições: estoque físico nunca negativo; reserva nunca negativa;
  // se enforce, disponível (físico - reservado) não pode ficar negativo
  const rows = await tx.$queryRaw<{ stockQty: number; reservedQty: number }[]>`
    UPDATE products
       SET "stockQty" = "stockQty" + ${stockDelta},
           "reservedQty" = GREATEST(0, "reservedQty" + ${reservedDelta}),
           "updatedAt" = now()
     WHERE id = ${productId}::uuid
       AND (${!args.enforce} OR ("stockQty" + ${stockDelta}) >= 0)
       AND (${!args.enforce} OR ("stockQty" + ${stockDelta}) - GREATEST(0, "reservedQty" + ${reservedDelta}) >= 0)
    RETURNING "stockQty", "reservedQty"`;
  if (rows.length === 0) {
    const p = await tx.product.findUnique({ where: { id: productId }, select: { sku: true, name: true, stockQty: true, reservedQty: true } });
    throw unprocessable(
      `Estoque insuficiente para ${p?.sku ?? ''} – ${p?.name ?? ''} (disponível: ${(p?.stockQty ?? 0) - (p?.reservedQty ?? 0)}).`,
      'INSUFFICIENT_STOCK',
    );
  }
  const seq = args.orderId ? await tx.stockMovement.count({ where: { orderId: args.orderId, productId } }) : 0;
  const quantity = args.type === 'RESERVE' || args.type === 'RELEASE' ? reservedDelta : stockDelta;
  await tx.stockMovement.create({
    data: {
      productId,
      type: args.type,
      quantity,
      stockAfter: rows[0].stockQty,
      reservedAfter: rows[0].reservedQty,
      orderId: args.orderId ?? null,
      reason: args.reason ?? null,
      // impede movimentação duplicada de um mesmo pedido/produto
      dedupeKey: args.orderId ? `${args.orderId}:${productId}:${seq}` : null,
      userId: args.userId,
    },
  });
}

async function orderProductState(tx: Tx, orderId: string, productId: string) {
  const moves = await tx.stockMovement.findMany({ where: { orderId, productId }, select: { type: true, quantity: true } });
  let reserved = 0;
  let out = 0;
  for (const m of moves) {
    if (m.type === 'RESERVE' || m.type === 'RELEASE') reserved += m.quantity;
    if (m.type === 'OUT' || m.type === 'RETURN') out += m.quantity;
  }
  return { reserved, out: -out };
}

/**
 * Efeitos de estoque de uma mudança de status, conforme a política configurada.
 * Orçamentos nunca movimentam estoque.
 */
export async function applyStockForStatus(
  tx: Tx,
  settings: CompanySettings,
  order: { id: string; number: string | null; items: { productId: string; quantity: number; unitsPerSaleUnit?: number }[] },
  toStatus: OrderStatus,
  userId: string,
) {
  if (!settings.stockEnabled) return;
  const reserveAt: OrderStatus[] =
    settings.stockPolicy === 'ON_CONFIRM'
      ? ['CREATED', 'PENDING_APPROVAL', 'APPROVED']
      : settings.stockPolicy === 'ON_APPROVAL'
        ? ['APPROVED']
        : settings.stockPolicy === 'ON_PICKING'
          ? ['PICKING']
          : [];
  const enforce = settings.blockOnInsufficientStock;
  const ref = `Pedido ${order.number ?? order.id}`;

  // estoque é controlado em unidades do produto: caixas são convertidas (qtd × unidades por caixa)
  const perProduct = new Map<string, number>();
  for (const it of order.items) perProduct.set(it.productId, (perProduct.get(it.productId) ?? 0) + it.quantity * (it.unitsPerSaleUnit ?? 1));
  for (const item of [...perProduct.entries()].map(([productId, quantity]) => ({ productId, quantity }))) {
    const state = await orderProductState(tx, order.id, item.productId);
    if (reserveAt.includes(toStatus) && state.reserved === 0 && state.out === 0) {
      await moveStock(tx, { productId: item.productId, type: 'RESERVE', stockDelta: 0, reservedDelta: item.quantity, orderId: order.id, reason: ref, userId, enforce });
    }
    if (ORDER_DISPATCHED_STATUSES.includes(toStatus) && state.out === 0) {
      if (state.reserved > 0) {
        await moveStock(tx, { productId: item.productId, type: 'RELEASE', stockDelta: 0, reservedDelta: -state.reserved, orderId: order.id, reason: `${ref} – reserva consumida na expedição`, userId, enforce: false });
      }
      await moveStock(tx, { productId: item.productId, type: 'OUT', stockDelta: -item.quantity, reservedDelta: 0, orderId: order.id, reason: ref, userId, enforce });
    }
    if (toStatus === 'CANCELLED' || toStatus === 'REJECTED') {
      if (state.reserved > 0) {
        await moveStock(tx, { productId: item.productId, type: 'RELEASE', stockDelta: 0, reservedDelta: -state.reserved, orderId: order.id, reason: `${ref} – cancelamento`, userId, enforce: false });
      }
      if (state.out > 0) {
        await moveStock(tx, { productId: item.productId, type: 'RETURN', stockDelta: state.out, reservedDelta: 0, orderId: order.id, reason: `${ref} – devolução`, userId, enforce: false });
      }
    }
  }
}
