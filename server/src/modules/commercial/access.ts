import type { Prisma, SalesRep } from '@prisma/client';
import type { Tx } from '../../db';
import { AppError, notFound } from '../../lib/errors';

/** Filtro de clientes que o vendedor pode enxergar (responsável ou liberado para todos). */
export function clientScopeForRep(rep: SalesRep): Prisma.ClientWhereInput {
  return { deletedAt: null, OR: [{ salesRepId: rep.id }, { availableToAllReps: true }] };
}

/** Cadastros enviados pelo vendedor e ainda não aprovados: servem apenas para orçamento. */
export const CLIENT_PENDING_STATUSES = ['UNDER_REVIEW', 'PENDING_REGISTRATION'] as const;

/**
 * Garante que o cliente existe e está autorizado para o vendedor.
 * - Pedido: exige cliente ATIVO (aprovado pelo administrador/gestor).
 * - Orçamento: aceita também cliente com cadastro pendente de aprovação.
 */
export async function assertClientUsable(tx: Tx, rep: SalesRep, clientId: string, purpose: 'order' | 'quote' = 'order') {
  const client = await tx.client.findFirst({ where: { id: clientId, ...clientScopeForRep(rep) } });
  if (!client) throw notFound('Cliente');
  if (client.status === 'ACTIVE') return client;
  const pending = (CLIENT_PENDING_STATUSES as readonly string[]).includes(client.status);
  if (pending && purpose === 'quote') return client;
  if (pending) {
    throw new AppError(
      422,
      'O cadastro deste cliente ainda aguarda aprovação. Faça um orçamento; depois da aprovação você poderá transformá-lo em pedido.',
      'CLIENT_PENDING_APPROVAL',
    );
  }
  throw new AppError(422, 'Este cliente não está ativo. Fale com o administrador.', 'CLIENT_NOT_ACTIVE');
}

/** Filtro de pedidos/orçamentos visíveis ao vendedor. */
export function docScopeForRep(rep: SalesRep): { salesRepId?: string } {
  return rep.canViewAllOrders ? {} : { salesRepId: rep.id };
}
