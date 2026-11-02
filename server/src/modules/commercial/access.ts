import type { Prisma, SalesRep } from '@prisma/client';
import type { Tx } from '../../db';
import { AppError, notFound } from '../../lib/errors';

/** Filtro de clientes que o vendedor pode enxergar (responsável ou liberado para todos). */
export function clientScopeForRep(rep: SalesRep): Prisma.ClientWhereInput {
  return { deletedAt: null, OR: [{ salesRepId: rep.id }, { availableToAllReps: true }] };
}

/** Garante que o cliente existe, está ATIVO e autorizado para o vendedor. */
export async function assertClientUsable(tx: Tx, rep: SalesRep, clientId: string) {
  const client = await tx.client.findFirst({ where: { id: clientId, ...clientScopeForRep(rep) } });
  if (!client) throw notFound('Cliente');
  if (client.status !== 'ACTIVE') {
    throw new AppError(422, 'Este cliente não está ativo. Solicite a liberação ao administrador.', 'CLIENT_NOT_ACTIVE');
  }
  return client;
}

/** Filtro de pedidos/orçamentos visíveis ao vendedor. */
export function docScopeForRep(rep: SalesRep): { salesRepId?: string } {
  return rep.canViewAllOrders ? {} : { salesRepId: rep.id };
}
