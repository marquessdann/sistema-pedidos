import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { audit, type AuditActor } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import { CLIENT_PENDING_STATUSES } from './access';

export type ReviewDecision = 'APPROVE' | 'RETURN' | 'REJECT';

/** Pendências cadastrais: clientes enviados pelos vendedores aguardando aprovação. */
export async function pendingClients(repIds?: string[]) {
  const where: Prisma.ClientWhereInput = {
    deletedAt: null,
    status: { in: [...CLIENT_PENDING_STATUSES] },
    ...(repIds ? { salesRepId: { in: repIds } } : {}),
  };
  const items = await prisma.client.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: { salesRep: { select: { id: true, fullName: true } } },
  });
  const userIds = [...new Set(items.flatMap((c) => [c.createdById, c.updatedById]).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const quotes = await prisma.quote.groupBy({ by: ['clientId'], where: { clientId: { in: items.map((c) => c.id) } }, _count: true });
  return items.map((c) => ({
    ...c,
    createdByName: name(c.createdById),
    updatedByName: name(c.updatedById),
    quoteCount: quotes.find((q) => q.clientId === c.id)?._count ?? 0,
  }));
}

/**
 * Decisão sobre o cadastro (administrador ou gestor com permissão):
 * - APPROVE: cliente ativo — o vendedor passa a poder fazer pedidos e converter orçamentos.
 * - RETURN: devolvido ao vendedor para correção (continua só com orçamentos).
 * - REJECT: recusado (bloqueado).
 */
export async function reviewClient(act: AuditActor & { userId: string }, clientId: string, decision: ReviewDecision, note: string | null, repIds?: string[]) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.client.findFirst({ where: { id: clientId, deletedAt: null, ...(repIds ? { salesRepId: { in: repIds } } : {}) } });
    if (!c) throw notFound('Cliente');
    if (!(CLIENT_PENDING_STATUSES as readonly string[]).includes(c.status)) throw conflict('Este cadastro não está pendente de aprovação.', 'NOT_PENDING');
    if (decision !== 'APPROVE' && (!note || note.trim().length < 3)) {
      throw new AppError(422, 'Informe o motivo para o vendedor saber o que corrigir.', 'NOTE_REQUIRED');
    }
    if (decision === 'APPROVE' && !c.salesRepId && !c.availableToAllReps) {
      throw new AppError(422, 'Defina o vendedor responsável antes de aprovar.', 'CLIENT_NEEDS_REP');
    }
    const status = decision === 'APPROVE' ? 'ACTIVE' : decision === 'RETURN' ? 'PENDING_REGISTRATION' : 'BLOCKED';
    const upd = await tx.client.updateMany({
      where: { id: clientId, status: c.status },
      data: { status, reviewNote: note?.trim() || null, reviewedById: act.userId, reviewedAt: new Date(), updatedById: act.userId },
    });
    if (!upd.count) throw conflict('O cadastro foi alterado por outra pessoa. Recarregue a página.', 'STALE');
    await audit(tx, act, decision === 'APPROVE' ? 'CLIENT_APPROVED' : decision === 'RETURN' ? 'CLIENT_RETURNED' : 'CLIENT_REJECTED', 'client', clientId, {
      legalName: c.legalName,
      from: c.status,
      to: status,
      note,
    });
    return { id: clientId, status };
  });
}
