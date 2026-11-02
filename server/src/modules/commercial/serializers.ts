import type { Prisma } from '@prisma/client';
import { fromDbDate } from '../../lib/validation';

/** Campos internos que nunca devem chegar ao vendedor (salvo permissão) nem ao cliente. */
const INTERNAL_DOC_FIELDS = ['costCents', 'internalTaxCents', 'marginCents'] as const;
const INTERNAL_ITEM_FIELDS = ['unitCostCents', 'taxRefBps'] as const;

export const orderDetailInclude = {
  client: {
    select: {
      id: true,
      legalName: true,
      tradeName: true,
      cnpj: true,
      responsibleName: true,
      commercialPhone: true,
      commercialEmail: true,
      financeEmail: true,
      city: true,
      state: true,
    },
  },
  salesRep: { select: { id: true, fullName: true, phone: true, contactPhone: true, email: true } },
  items: { orderBy: { position: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true, role: true } } } },
  approvals: { orderBy: { createdAt: 'desc' }, include: { decidedBy: { select: { name: true } } } },
  documents: { orderBy: { createdAt: 'desc' }, select: { id: true, version: true, createdAt: true, sizeBytes: true } },
  quote: { select: { id: true, number: true } },
} satisfies Prisma.OrderInclude;

export const quoteDetailInclude = {
  client: orderDetailInclude.client,
  salesRep: orderDetailInclude.salesRep,
  items: { orderBy: { position: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true, role: true } } } },
  approvals: { orderBy: { createdAt: 'desc' }, include: { decidedBy: { select: { name: true } } } },
  documents: { orderBy: { createdAt: 'desc' }, select: { id: true, version: true, createdAt: true, sizeBytes: true } },
  convertedOrder: { select: { id: true, number: true, status: true } },
} satisfies Prisma.QuoteInclude;

type AnyRecord = Record<string, unknown>;

function stripInternal(doc: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...doc };
  for (const f of INTERNAL_DOC_FIELDS) delete out[f];
  if (out.calcSnapshot && typeof out.calcSnapshot === 'object') {
    const { internal: _internal, ...snap } = out.calcSnapshot as AnyRecord;
    out.calcSnapshot = snap;
  }
  if (Array.isArray(out.items)) {
    out.items = (out.items as AnyRecord[]).map((it) => {
      const c = { ...it };
      for (const f of INTERNAL_ITEM_FIELDS) delete c[f];
      return c;
    });
  }
  return out;
}

function dates(doc: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...doc };
  for (const k of ['orderDate', 'quoteDate', 'validUntil', 'expectedDelivery']) {
    if (k in out) out[k] = fromDbDate(out[k] as Date | null);
  }
  return out;
}

/** Serializa pedido/orçamento. `internal=true` somente para administrador (ou vendedor com permissão de custo). */
export function serializeDoc<T extends object>(doc: T, internal: boolean): AnyRecord {
  const base = dates(doc as unknown as AnyRecord);
  return internal ? base : stripInternal(base);
}
