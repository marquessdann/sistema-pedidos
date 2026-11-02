import { prisma } from '../../db';
import { audit, type AuditActor } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';
import { getSettings } from '../../lib/settings';
import { applyStockForStatus } from './stockService';

/**
 * Decisão do administrador sobre um desconto excepcional.
 * - Pedido aprovado: segue para "Pedido aprovado".
 * - Pedido reprovado: volta para rascunho (mantém o número e o histórico) para o vendedor ajustar o desconto.
 * - Orçamento: libera (ou não) o envio/conversão com o desconto solicitado.
 */
export async function decideApproval(
  act: AuditActor & { userId: string },
  approvalId: string,
  decision: 'APPROVED' | 'REJECTED',
  note: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.discountApproval.findUnique({ where: { id: approvalId } });
    if (!approval) throw notFound('Solicitação de aprovação');
    const upd = await tx.discountApproval.updateMany({
      where: { id: approvalId, status: 'PENDING' },
      data: { status: decision, decidedById: act.userId, decidedAt: new Date(), decisionNote: note },
    });
    if (upd.count === 0) throw conflict('Esta solicitação já foi decidida ou cancelada.', 'ALREADY_DECIDED');

    if (approval.orderId) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: approval.orderId }, include: { items: true } });
      if (order.status !== 'PENDING_APPROVAL') throw conflict('O pedido não está aguardando aprovação.', 'STALE');
      const toStatus = decision === 'APPROVED' ? 'APPROVED' : 'DRAFT';
      await tx.order.update({
        where: { id: order.id },
        data: { status: toStatus, discountApprovalStatus: decision, version: { increment: 1 } },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: 'PENDING_APPROVAL',
          toStatus,
          userId: act.userId,
          note:
            decision === 'APPROVED'
              ? `Desconto aprovado pelo administrador.${note ? ` ${note}` : ''}`
              : `Desconto reprovado – pedido devolvido ao vendedor para ajuste.${note ? ` Motivo: ${note}` : ''}`,
        },
      });
      if (toStatus === 'APPROVED') await applyStockForStatus(tx, await getSettings(tx), order, 'APPROVED', act.userId);
    } else if (approval.quoteId) {
      await tx.quote.update({ where: { id: approval.quoteId }, data: { discountApprovalStatus: decision } });
      await tx.quoteStatusHistory.create({
        data: {
          quoteId: approval.quoteId,
          fromStatus: null,
          toStatus: (await tx.quote.findUniqueOrThrow({ where: { id: approval.quoteId } })).status,
          userId: act.userId,
          note: decision === 'APPROVED' ? `Desconto aprovado pelo administrador.${note ? ` ${note}` : ''}` : `Desconto reprovado.${note ? ` Motivo: ${note}` : ''}`,
        },
      });
    }
    await audit(tx, act, decision === 'APPROVED' ? 'DISCOUNT_APPROVED' : 'DISCOUNT_REJECTED', approval.orderId ? 'order' : 'quote', approval.orderId ?? approval.quoteId, {
      approvalId,
      requestedBps: approval.requestedBps,
      maxAllowedBps: approval.maxAllowedBps,
      note,
    });
    return { decision };
  });
}
