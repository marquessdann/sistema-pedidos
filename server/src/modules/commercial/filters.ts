import type { OrderStatus, Prisma, QuoteStatus } from '@prisma/client';
import { z } from 'zod';
import { normalizeCnpj, ORDER_STATUSES, QUOTE_STATUSES } from '@della/shared';
import { isoDate, paginationSchema, toDbDate } from '../../lib/validation';

const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',').filter((s) => (values as readonly string[]).includes(s)) as T[]) : undefined));

const money = z.coerce.number().int().min(0).optional();

export const orderFilterSchema = paginationSchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  number: z.string().trim().max(40).optional(),
  clientId: z.string().uuid().optional(),
  cnpj: z.string().trim().max(20).optional(),
  q: z.string().trim().max(100).optional(),
  salesRepId: z.string().uuid().optional(),
  status: csv(ORDER_STATUSES),
  minCents: money,
  maxCents: money,
  brandId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  sort: z.enum(['date_desc', 'date_asc', 'total_desc', 'total_asc', 'number_desc', 'number_asc']).default('date_desc'),
  includeDrafts: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});
export type OrderFilter = z.infer<typeof orderFilterSchema>;

export function orderWhere(f: OrderFilter): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (f.from) and.push({ orderDate: { gte: toDbDate(f.from)! } });
  if (f.to) and.push({ orderDate: { lte: toDbDate(f.to)! } });
  if (f.number) and.push({ number: { contains: f.number.toUpperCase() } });
  if (f.clientId) and.push({ clientId: f.clientId });
  if (f.cnpj) and.push({ client: { cnpj: { contains: normalizeCnpj(f.cnpj) } } });
  if (f.q) {
    and.push({
      OR: [
        { number: { contains: f.q.toUpperCase() } },
        { client: { legalName: { contains: f.q, mode: 'insensitive' } } },
        { client: { tradeName: { contains: f.q, mode: 'insensitive' } } },
        ...(normalizeCnpj(f.q).length >= 3 ? [{ client: { cnpj: { contains: normalizeCnpj(f.q) } } }] : []),
      ],
    });
  }
  if (f.salesRepId) and.push({ salesRepId: f.salesRepId });
  if (f.status?.length) and.push({ status: { in: f.status as OrderStatus[] } });
  else if (!f.includeDrafts) and.push({ status: { not: 'DRAFT' } });
  if (f.minCents !== undefined) and.push({ totalCents: { gte: f.minCents } });
  if (f.maxCents !== undefined) and.push({ totalCents: { lte: f.maxCents } });
  if (f.brandId) and.push({ items: { some: { product: { brandId: f.brandId } } } });
  if (f.productId) and.push({ items: { some: { productId: f.productId } } });
  return { AND: and };
}

export function orderOrderBy(sort: OrderFilter['sort']): Prisma.OrderOrderByWithRelationInput[] {
  switch (sort) {
    case 'date_asc':
      return [{ orderDate: 'asc' }, { createdAt: 'asc' }];
    case 'total_desc':
      return [{ totalCents: 'desc' }];
    case 'total_asc':
      return [{ totalCents: 'asc' }];
    case 'number_desc':
      return [{ number: 'desc' }];
    case 'number_asc':
      return [{ number: 'asc' }];
    default:
      return [{ orderDate: 'desc' }, { createdAt: 'desc' }];
  }
}

export const quoteFilterSchema = paginationSchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  clientId: z.string().uuid().optional(),
  salesRepId: z.string().uuid().optional(),
  status: csv(QUOTE_STATUSES),
  sort: z.enum(['date_desc', 'date_asc', 'total_desc', 'total_asc', 'number_desc', 'number_asc']).default('date_desc'),
});
export type QuoteFilter = z.infer<typeof quoteFilterSchema>;

export function quoteWhere(f: QuoteFilter): Prisma.QuoteWhereInput {
  const and: Prisma.QuoteWhereInput[] = [];
  if (f.from) and.push({ quoteDate: { gte: toDbDate(f.from)! } });
  if (f.to) and.push({ quoteDate: { lte: toDbDate(f.to)! } });
  if (f.clientId) and.push({ clientId: f.clientId });
  if (f.salesRepId) and.push({ salesRepId: f.salesRepId });
  if (f.status?.length) and.push({ status: { in: f.status as QuoteStatus[] } });
  if (f.q) {
    and.push({
      OR: [
        { number: { contains: f.q.toUpperCase() } },
        { client: { legalName: { contains: f.q, mode: 'insensitive' } } },
        { client: { tradeName: { contains: f.q, mode: 'insensitive' } } },
        ...(normalizeCnpj(f.q).length >= 3 ? [{ client: { cnpj: { contains: normalizeCnpj(f.q) } } }] : []),
      ],
    });
  }
  return { AND: and };
}

export function quoteOrderBy(sort: QuoteFilter['sort']): Prisma.QuoteOrderByWithRelationInput[] {
  switch (sort) {
    case 'date_asc':
      return [{ quoteDate: 'asc' }, { createdAt: 'asc' }];
    case 'total_desc':
      return [{ totalCents: 'desc' }];
    case 'total_asc':
      return [{ totalCents: 'asc' }];
    case 'number_desc':
      return [{ number: 'desc' }];
    case 'number_asc':
      return [{ number: 'asc' }];
    default:
      return [{ quoteDate: 'desc' }, { createdAt: 'desc' }];
  }
}

export const listSelectClient = { select: { id: true, legalName: true, tradeName: true, cnpj: true } } as const;
