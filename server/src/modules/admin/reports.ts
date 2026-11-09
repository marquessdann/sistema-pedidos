import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  CLIENT_STATUS_LABELS,
  ORDER_CONFIRMED_STATUSES,
  ORDER_FULFILLED_STATUSES,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  addDays,
  mulBps,
  formatCnpj,
  type OrderStatus,
} from '@della/shared';
import { prisma, Prisma } from '../../db';
import { getSettings, today } from '../../lib/settings';
import { isoDate } from '../../lib/validation';

const filterSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  clientId: z.string().uuid().optional(),
  salesRepId: z.string().uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',').filter((s) => (ORDER_STATUSES as readonly string[]).includes(s)) as OrderStatus[]) : undefined)),
});
/** repIds: quando definido, restringe tudo a esses vendedores (acesso do gestor). */
export type Filter = z.infer<typeof filterSchema> & { from: string; to: string; repIds?: string[] };

export async function withDefaults(raw: unknown, repIds?: string[]): Promise<Filter> {
  const f = filterSchema.parse(raw);
  if (repIds && f.salesRepId && !repIds.includes(f.salesRepId)) {
    throw Object.assign(new Error('Vendedor fora da sua supervisão.'), { statusCode: 403 });
  }
  const t = today(await getSettings());
  return { ...f, from: f.from ?? `${t.slice(0, 7)}-01`, to: f.to ?? t, repIds };
}

function repScopeSql(alias: 'o' | 'q', repIds?: string[]) {
  if (!repIds) return null;
  if (!repIds.length) return Prisma.sql`FALSE`;
  return alias === 'o'
    ? Prisma.sql`o."salesRepId"::text IN (${Prisma.join(repIds)})`
    : Prisma.sql`q."salesRepId"::text IN (${Prisma.join(repIds)})`;
}

const num = (v: unknown) => Number(v ?? 0);

/** Condições SQL para a tabela de pedidos (alias o). */
function orderConds(f: Filter, statuses: readonly string[] = ORDER_CONFIRMED_STATUSES) {
  const parts: Prisma.Sql[] = [
    Prisma.sql`o."orderDate" BETWEEN ${f.from}::date AND ${f.to}::date`,
    Prisma.sql`o.status::text IN (${Prisma.join(f.status?.length ? f.status : [...statuses])})`,
  ];
  if (f.clientId) parts.push(Prisma.sql`o."clientId" = ${f.clientId}::uuid`);
  if (f.salesRepId) parts.push(Prisma.sql`o."salesRepId" = ${f.salesRepId}::uuid`);
  const scope = repScopeSql('o', f.repIds);
  if (scope) parts.push(scope);
  return Prisma.join(parts, ' AND ');
}

function quoteConds(f: Filter) {
  const parts: Prisma.Sql[] = [Prisma.sql`q."quoteDate" BETWEEN ${f.from}::date AND ${f.to}::date`];
  if (f.clientId) parts.push(Prisma.sql`q."clientId" = ${f.clientId}::uuid`);
  if (f.salesRepId) parts.push(Prisma.sql`q."salesRepId" = ${f.salesRepId}::uuid`);
  const scope = repScopeSql('q', f.repIds);
  if (scope) parts.push(scope);
  return Prisma.join(parts, ' AND ');
}

type ColType = 'text' | 'money' | 'int' | 'percent' | 'date';
interface Report {
  title: string;
  description?: string;
  columns: { key: string; label: string; type: ColType }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

function sumCols(rows: Record<string, unknown>[], keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + num(r[k]), 0)]));
}

export async function buildReport(kind: string, f: Filter): Promise<Report> {
  switch (kind) {
    case 'orders':
    case 'pending':
    case 'cancelled': {
      const statuses =
        kind === 'pending'
          ? ['CREATED', 'PENDING_APPROVAL', 'APPROVED', 'INVOICED', 'AWAITING_PICKING', 'LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT']
          : kind === 'cancelled'
            ? ['CANCELLED', 'REJECTED']
            : ORDER_CONFIRMED_STATUSES;
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT o.number, to_char(o."orderDate", 'YYYY-MM-DD') AS date, c."legalName" AS client, c.cnpj, r."fullName" AS rep,
               o.status::text AS status, o."totalQuantity" AS qty, o."grossCents" AS gross,
               (o."itemDiscountCents" + o."generalDiscountCents") AS discount, o."surchargeCents" AS surcharge,
               o."freightCents" AS freight, o."totalCents" AS total, o."cancelReason" AS reason
          FROM orders o JOIN clients c ON c.id = o."clientId" JOIN sales_representatives r ON r.id = o."salesRepId"
         WHERE ${orderConds(f, statuses)}
         ORDER BY o."orderDate" DESC, o.number DESC`;
      const mapped = rows.map((r) => ({ ...r, cnpj: formatCnpj(String(r.cnpj)), status: ORDER_STATUS_LABELS[r.status as OrderStatus] }));
      const title = kind === 'pending' ? 'Pedidos pendentes' : kind === 'cancelled' ? 'Pedidos cancelados e reprovados' : 'Pedidos por período';
      return {
        title,
        columns: [
          { key: 'number', label: 'Pedido', type: 'text' },
          { key: 'date', label: 'Data', type: 'date' },
          { key: 'client', label: 'Cliente', type: 'text' },
          { key: 'cnpj', label: 'CNPJ', type: 'text' },
          { key: 'rep', label: 'Vendedor', type: 'text' },
          { key: 'status', label: 'Status', type: 'text' },
          { key: 'qty', label: 'Qtd. itens', type: 'int' },
          { key: 'gross', label: 'Valor bruto', type: 'money' },
          { key: 'discount', label: 'Descontos', type: 'money' },
          { key: 'surcharge', label: 'Acréscimos', type: 'money' },
          { key: 'freight', label: 'Frete', type: 'money' },
          { key: 'total', label: 'Valor líquido', type: 'money' },
          ...(kind === 'cancelled' ? [{ key: 'reason', label: 'Motivo', type: 'text' as const }] : []),
        ],
        rows: mapped,
        totals: { number: `${mapped.length} pedido(s)`, ...sumCols(mapped, ['qty', 'gross', 'discount', 'surcharge', 'freight', 'total']) },
      };
    }
    case 'by-rep': {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT r."fullName" AS rep, COUNT(*)::int AS orders, SUM(o."grossCents")::bigint AS gross,
               SUM(o."itemDiscountCents" + o."generalDiscountCents")::bigint AS discount, SUM(o."totalCents")::bigint AS total,
               SUM(CASE WHEN o.status::text IN (${Prisma.join([...ORDER_FULFILLED_STATUSES])}) THEN o."totalCents" ELSE 0 END)::bigint AS fulfilled,
               ROUND(AVG(o."totalCents"))::bigint AS avg
          FROM orders o JOIN sales_representatives r ON r.id = o."salesRepId"
         WHERE ${orderConds(f)}
         GROUP BY r.id, r."fullName" ORDER BY total DESC`;
      const mapped = rows.map((r) => ({ ...r, orders: num(r.orders), gross: num(r.gross), discount: num(r.discount), total: num(r.total), fulfilled: num(r.fulfilled), avg: num(r.avg) }));
      return {
        title: 'Vendas por vendedor',
        description: '“Faturado” considera pedidos faturados, enviados, em rota, entregues ou concluídos.',
        columns: [
          { key: 'rep', label: 'Vendedor', type: 'text' },
          { key: 'orders', label: 'Pedidos', type: 'int' },
          { key: 'gross', label: 'Valor bruto', type: 'money' },
          { key: 'discount', label: 'Descontos', type: 'money' },
          { key: 'total', label: 'Valor líquido (pedidos)', type: 'money' },
          { key: 'fulfilled', label: 'Faturado (expedido)', type: 'money' },
          { key: 'avg', label: 'Ticket médio', type: 'money' },
        ],
        rows: mapped,
        totals: { rep: 'Total', ...sumCols(mapped, ['orders', 'gross', 'discount', 'total', 'fulfilled']) },
      };
    }
    case 'by-client': {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c."legalName" AS client, c.cnpj, c.city, c.state, COUNT(*)::int AS orders, SUM(o."totalCents")::bigint AS total,
               to_char(MAX(o."orderDate"), 'YYYY-MM-DD') AS last
          FROM orders o JOIN clients c ON c.id = o."clientId"
         WHERE ${orderConds(f)}
         GROUP BY c.id ORDER BY total DESC`;
      const mapped = rows.map((r) => ({ ...r, cnpj: formatCnpj(String(r.cnpj)), city: [r.city, r.state].filter(Boolean).join('/'), orders: num(r.orders), total: num(r.total) }));
      return {
        title: 'Vendas por cliente',
        columns: [
          { key: 'client', label: 'Cliente', type: 'text' },
          { key: 'cnpj', label: 'CNPJ', type: 'text' },
          { key: 'city', label: 'Cidade/UF', type: 'text' },
          { key: 'orders', label: 'Pedidos', type: 'int' },
          { key: 'total', label: 'Valor líquido', type: 'money' },
          { key: 'last', label: 'Último pedido', type: 'date' },
        ],
        rows: mapped,
        totals: { client: 'Total', ...sumCols(mapped, ['orders', 'total']) },
      };
    }
    case 'top-products': {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT i.sku, i."productName" AS product, i."brandName" AS brand, SUM(i.quantity * i."unitsPerSaleUnit")::bigint AS qty,
               COUNT(DISTINCT o.id)::int AS orders, SUM(i."grossCents")::bigint AS gross, SUM(i."netCents")::bigint AS net
          FROM order_items i JOIN orders o ON o.id = i."orderId"
         WHERE ${orderConds(f)}
         GROUP BY i.sku, i."productName", i."brandName" ORDER BY qty DESC`;
      const mapped = rows.map((r) => ({ ...r, qty: num(r.qty), orders: num(r.orders), gross: num(r.gross), net: num(r.net) }));
      return {
        title: 'Produtos mais vendidos / quantidades por SKU',
        columns: [
          { key: 'sku', label: 'SKU', type: 'text' },
          { key: 'product', label: 'Produto', type: 'text' },
          { key: 'brand', label: 'Marca', type: 'text' },
          { key: 'qty', label: 'Quantidade (unidades)', type: 'int' },
          { key: 'orders', label: 'Pedidos', type: 'int' },
          { key: 'gross', label: 'Valor bruto', type: 'money' },
          { key: 'net', label: 'Valor líquido', type: 'money' },
        ],
        rows: mapped,
        totals: { sku: 'Total', ...sumCols(mapped, ['qty', 'gross', 'net']) },
      };
    }
    case 'quotes': {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT q.number, to_char(q."quoteDate", 'YYYY-MM-DD') AS date, to_char(q."validUntil", 'YYYY-MM-DD') AS valid,
               c."legalName" AS client, r."fullName" AS rep, q.status::text AS status, q."totalCents" AS total, o.number AS "order"
          FROM quotes q JOIN clients c ON c.id = q."clientId" JOIN sales_representatives r ON r.id = q."salesRepId"
          LEFT JOIN orders o ON o.id = q."convertedOrderId"
         WHERE ${quoteConds(f)}
         ORDER BY q."quoteDate" DESC, q.number DESC`;
      const mapped = rows.map((r) => ({ ...r, status: QUOTE_STATUS_LABELS[r.status as keyof typeof QUOTE_STATUS_LABELS], total: num(r.total) }));
      return {
        title: 'Orçamentos gerados',
        description: 'Orçamentos são propostas e não representam vendas realizadas.',
        columns: [
          { key: 'number', label: 'Orçamento', type: 'text' },
          { key: 'date', label: 'Data', type: 'date' },
          { key: 'valid', label: 'Validade', type: 'date' },
          { key: 'client', label: 'Cliente', type: 'text' },
          { key: 'rep', label: 'Vendedor', type: 'text' },
          { key: 'status', label: 'Status', type: 'text' },
          { key: 'total', label: 'Valor proposto', type: 'money' },
          { key: 'order', label: 'Pedido gerado', type: 'text' },
        ],
        rows: mapped,
        totals: { number: `${mapped.length} orçamento(s)`, ...sumCols(mapped, ['total']) },
      };
    }
    case 'quote-conversion': {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT r."fullName" AS rep, COUNT(*)::int AS quotes,
               SUM(CASE WHEN q.status = 'CONVERTED' THEN 1 ELSE 0 END)::int AS converted,
               SUM(q."totalCents")::bigint AS quoted,
               SUM(CASE WHEN q.status = 'CONVERTED' THEN q."totalCents" ELSE 0 END)::bigint AS "convertedValue"
          FROM quotes q JOIN sales_representatives r ON r.id = q."salesRepId"
         WHERE ${quoteConds(f)}
         GROUP BY r.id, r."fullName" ORDER BY quotes DESC`;
      const mapped = rows.map((r) => {
        const quotes = num(r.quotes);
        const converted = num(r.converted);
        return { rep: r.rep, quotes, converted, rate: quotes ? Math.round((converted * 10000) / quotes) : 0, quoted: num(r.quoted), convertedValue: num(r.convertedValue) };
      });
      const tq = mapped.reduce((a, r) => a + r.quotes, 0);
      const tc = mapped.reduce((a, r) => a + r.converted, 0);
      return {
        title: 'Orçamentos convertidos e taxa de conversão',
        columns: [
          { key: 'rep', label: 'Vendedor', type: 'text' },
          { key: 'quotes', label: 'Orçamentos', type: 'int' },
          { key: 'converted', label: 'Convertidos', type: 'int' },
          { key: 'rate', label: 'Taxa de conversão', type: 'percent' },
          { key: 'quoted', label: 'Valor orçado', type: 'money' },
          { key: 'convertedValue', label: 'Valor convertido', type: 'money' },
        ],
        rows: mapped,
        totals: { rep: 'Total', quotes: tq, converted: tc, rate: tq ? Math.round((tc * 10000) / tq) : 0, ...sumCols(mapped, ['quoted', 'convertedValue']) },
      };
    }
    case 'discounts': {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT o.number, to_char(o."orderDate", 'YYYY-MM-DD') AS date, c."legalName" AS client, r."fullName" AS rep,
               o."grossCents" AS gross, o."itemDiscountCents" AS item, o."generalDiscountBps" AS "generalBps",
               o."generalDiscountCents" AS general, o."effectiveDiscountBps" AS effective, r."maxDiscountBps" AS "limit",
               o."discountApprovalStatus"::text AS approval, o."totalCents" AS total
          FROM orders o JOIN clients c ON c.id = o."clientId" JOIN sales_representatives r ON r.id = o."salesRepId"
         WHERE ${orderConds(f)} AND (o."itemDiscountCents" + o."generalDiscountCents") > 0
         ORDER BY o."effectiveDiscountBps" DESC`;
      const labels: Record<string, string> = { NONE: 'Dentro do limite', PENDING: 'Aguardando', APPROVED: 'Aprovado (exceção)', REJECTED: 'Reprovado' };
      const mapped = rows.map((r) => ({ ...r, approval: labels[String(r.approval)] ?? r.approval, discount: num(r.item) + num(r.general) }));
      return {
        title: 'Descontos concedidos',
        columns: [
          { key: 'number', label: 'Pedido', type: 'text' },
          { key: 'date', label: 'Data', type: 'date' },
          { key: 'client', label: 'Cliente', type: 'text' },
          { key: 'rep', label: 'Vendedor', type: 'text' },
          { key: 'gross', label: 'Valor bruto', type: 'money' },
          { key: 'item', label: 'Desc. itens', type: 'money' },
          { key: 'general', label: 'Desc. geral', type: 'money' },
          { key: 'discount', label: 'Desconto total', type: 'money' },
          { key: 'effective', label: '% efetivo', type: 'percent' },
          { key: 'limit', label: 'Limite vendedor', type: 'percent' },
          { key: 'approval', label: 'Aprovação', type: 'text' },
          { key: 'total', label: 'Valor líquido', type: 'money' },
        ],
        rows: mapped,
        totals: { number: `${mapped.length} pedido(s)`, ...sumCols(mapped, ['gross', 'item', 'general', 'discount', 'total']) },
      };
    }
    case 'summary': {
      const groups: [string, readonly string[]][] = [
        ['Pedidos criados (todos os confirmados)', ORDER_CONFIRMED_STATUSES],
        ['Pedidos aprovados ou em andamento', ['APPROVED', 'INVOICED', 'AWAITING_PICKING', 'LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT']],
        ['Faturamento realizado (faturados em diante)', ORDER_FULFILLED_STATUSES],
        ['Aguardando aprovação', ['CREATED', 'PENDING_APPROVAL']],
        ['Cancelados / reprovados', ['CANCELLED', 'REJECTED']],
      ];
      const rows = [];
      for (const [label, statuses] of groups) {
        const r = await prisma.$queryRaw<Record<string, unknown>[]>`
          SELECT COUNT(*)::int AS orders, COALESCE(SUM(o."grossCents"),0)::bigint AS gross,
                 COALESCE(SUM(o."itemDiscountCents" + o."generalDiscountCents"),0)::bigint AS discount,
                 COALESCE(SUM(o."totalCents"),0)::bigint AS total
            FROM orders o WHERE ${orderConds({ ...f, status: undefined }, statuses)}`;
        rows.push({ group: label, orders: num(r[0].orders), gross: num(r[0].gross), discount: num(r[0].discount), total: num(r[0].total) });
      }
      const q = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT COUNT(*)::int AS quotes, COALESCE(SUM(q."totalCents"),0)::bigint AS total FROM quotes q WHERE ${quoteConds(f)}`;
      rows.push({ group: 'Orçamentos emitidos (não são vendas)', orders: num(q[0].quotes), gross: null, discount: null, total: num(q[0].total) });
      return {
        title: 'Resumo: valor bruto x líquido',
        description: 'Diferencia pedidos criados, aprovados e faturamento efetivamente realizado. Orçamentos não são vendas.',
        columns: [
          { key: 'group', label: 'Grupo', type: 'text' },
          { key: 'orders', label: 'Quantidade', type: 'int' },
          { key: 'gross', label: 'Valor bruto', type: 'money' },
          { key: 'discount', label: 'Descontos', type: 'money' },
          { key: 'total', label: 'Valor líquido', type: 'money' },
        ],
        rows,
      };
    }
    default:
      throw Object.assign(new Error('Relatório não encontrado.'), { statusCode: 404 });
  }
}

export function csvValue(v: unknown, type: ColType): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (type === 'money') s = (num(v) / 100).toFixed(2).replace('.', ',');
  else if (type === 'percent') s = (num(v) / 100).toFixed(2).replace('.', ',') + '%';
  else if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) s = v.split('-').reverse().join('/');
  else s = String(v);
  // proteção contra injeção de fórmulas em planilhas
  if (/^[=+\-@\t\r]/.test(s) && type === 'text') s = `'${s}`;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function adminReportRoutes(app: FastifyInstance) {
  app.get('/reports/:kind', async (req, reply) => {
    const { kind } = z.object({ kind: z.string().max(30) }).parse(req.params);
    const { format } = z.object({ format: z.enum(['json', 'csv']).default('json') }).parse(req.query);
    const f = await withDefaults(req.query);
    const report = await buildReport(kind, f);
    if (format === 'csv') {
      const lines = [report.columns.map((c) => csvValue(c.label, 'text')).join(';')];
      for (const r of report.rows) lines.push(report.columns.map((c) => csvValue(r[c.key], c.type)).join(';'));
      if (report.totals) lines.push(report.columns.map((c) => csvValue(report.totals![c.key], c.type)).join(';'));
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="relatorio-${kind}-${f.from}-a-${f.to}.csv"`);
      return reply.send('﻿' + lines.join('\r\n'));
    }
    return { ...report, filter: f };
  });

  app.get('/dashboard', async (req) => dashboardData(req.query));
  app.get('/commissions', async (req, reply) => sendCommissions(req.query, reply));
}

/** Calculadora de comissão: base = valor dos produtos (total − frete − acréscimos), após descontos. */
const commissionSchema = z.object({
  basis: z.enum(['fulfilled', 'confirmed']).default('confirmed'),
  rateBps: z.coerce.number().int().min(0).max(10_000).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export async function commissionData(raw: unknown, repIds?: string[]) {
  const f = await withDefaults(raw, repIds);
  const c = commissionSchema.parse(raw);
  const statuses = c.basis === 'fulfilled' ? ORDER_FULFILLED_STATUSES : ORDER_CONFIRMED_STATUSES;
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT o.id, o.number, to_char(o."orderDate", 'YYYY-MM-DD') AS date, c."legalName" AS client, r.id AS "repId", r."fullName" AS rep,
           o.status::text AS status, o."totalCents" AS total, o."freightCents" AS freight, o."surchargeCents" AS surcharge,
           COALESCE(r."commissionBps", 0) AS "repRate"
      FROM orders o JOIN clients c ON c.id = o."clientId" JOIN sales_representatives r ON r.id = o."salesRepId"
     WHERE ${orderConds({ ...f, status: undefined }, statuses)}
     ORDER BY o."orderDate" DESC, o.number DESC`;
  const lines = rows.map((r) => {
    const base = num(r.total) - num(r.freight) - num(r.surcharge);
    const rateBps = c.rateBps ?? num(r.repRate);
    return {
      id: r.id as string,
      number: r.number as string,
      date: r.date as string,
      client: r.client as string,
      rep: r.rep as string,
      repId: r.repId as string,
      status: ORDER_STATUS_LABELS[r.status as OrderStatus],
      totalCents: num(r.total),
      baseCents: base,
      rateBps,
      commissionCents: mulBps(base, rateBps),
    };
  });
  const byRep = new Map<string, { rep: string; orders: number; baseCents: number; commissionCents: number; rateBps: number }>();
  for (const l of lines) {
    const cur = byRep.get(l.repId) ?? { rep: l.rep, orders: 0, baseCents: 0, commissionCents: 0, rateBps: l.rateBps };
    cur.orders += 1;
    cur.baseCents += l.baseCents;
    cur.commissionCents += l.commissionCents;
    byRep.set(l.repId, cur);
  }
  return {
    filter: { from: f.from, to: f.to, salesRepId: f.salesRepId ?? null, basis: c.basis, rateBps: c.rateBps ?? null },
    lines,
    byRep: [...byRep.values()],
    totals: {
      orders: lines.length,
      baseCents: lines.reduce((a, l) => a + l.baseCents, 0),
      commissionCents: lines.reduce((a, l) => a + l.commissionCents, 0),
    },
  };
}

export async function sendCommissions(raw: unknown, reply: FastifyReply, repIds?: string[]) {
  const d = await commissionData(raw, repIds);
  if ((raw as { format?: string })?.format !== 'csv') return d;
  const cols: [string, string, ColType][] = [
    ['number', 'Pedido', 'text'], ['date', 'Data', 'date'], ['client', 'Cliente', 'text'], ['rep', 'Vendedor', 'text'], ['status', 'Status', 'text'],
    ['totalCents', 'Valor do pedido', 'money'], ['baseCents', 'Base da comissão', 'money'], ['rateBps', '% comissão', 'percent'], ['commissionCents', 'Comissão', 'money'],
  ];
  const out = [cols.map((c) => csvValue(c[1], 'text')).join(';')];
  for (const l of d.lines) out.push(cols.map(([k, , t]) => csvValue((l as Record<string, unknown>)[k], t)).join(';'));
  out.push(['Total', '', '', '', `${d.totals.orders} pedido(s)`, '', csvValue(d.totals.baseCents, 'money'), '', csvValue(d.totals.commissionCents, 'money')].join(';'));
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="comissoes-${d.filter.from}-a-${d.filter.to}.csv"`);
  return reply.send('\uFEFF' + out.join('\r\n'));
}

/** Dados do painel. Com repIds, mostra somente os vendedores supervisionados. */
export async function dashboardData(raw: unknown, repIds?: string[]) {
  {
    const f = await withDefaults(raw, repIds);
    const settings = await getSettings();
    const t = today(settings);
    const repCond = f.salesRepId ? { salesRepId: f.salesRepId } : repIds ? { salesRepId: { in: repIds } } : {};
    const clientCond = f.clientId ? { clientId: f.clientId } : {};
    const statusIn = (s: OrderStatus[]) => ({ status: { in: f.status?.length ? s.filter((x) => f.status!.includes(x)) : s } });
    const period = { orderDate: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) } };
    const base = { ...repCond, ...clientCond };

    const [clients, clientsPending, activeProducts, ordersToday, pendingApproval, picking, shipped, completed, openQuotes, pendingDiscounts, invoiced] = await Promise.all([
      prisma.client.count({ where: { deletedAt: null, ...repCond } }),
      prisma.client.count({ where: { deletedAt: null, ...(repIds ? repCond : {}), status: { in: ['PENDING_REGISTRATION', 'UNDER_REVIEW'] } } }),
      prisma.product.count({ where: { deletedAt: null, active: true } }),
      prisma.order.count({ where: { ...base, orderDate: new Date(`${t}T00:00:00Z`), status: { notIn: ['DRAFT'] } } }),
      prisma.order.count({ where: { ...base, ...statusIn(['CREATED', 'PENDING_APPROVAL']) } }),
      prisma.order.count({ where: { ...base, ...statusIn(['AWAITING_PICKING', 'LOGISTICS_RECEIVED', 'PICKING', 'AWAITING_SHIPMENT']) } }),
      prisma.order.count({ where: { ...base, ...statusIn(['SHIPPED', 'OUT_FOR_DELIVERY']) } }),
      prisma.order.count({ where: { ...base, ...period, ...statusIn(['DELIVERED', 'COMPLETED']) } }),
      prisma.quote.count({ where: { ...base, status: { in: ['DRAFT', 'SENT', 'AWAITING_RESPONSE', 'APPROVED_BY_CLIENT'] } } }),
      prisma.discountApproval.count({ where: { status: 'PENDING', ...repCond } }),
      prisma.order.count({ where: { ...base, ...statusIn(['INVOICED']) } }),
    ]);
    const confirmedWhere = { ...base, ...period, ...statusIn([...ORDER_CONFIRMED_STATUSES]) };
    const agg = await prisma.order.aggregate({
      where: confirmedWhere,
      _sum: { totalCents: true, grossCents: true, itemDiscountCents: true, generalDiscountCents: true },
      _count: true,
    });
    const fulfilled = await prisma.order.aggregate({ where: { ...base, ...period, ...statusIn([...ORDER_FULFILLED_STATUSES]) }, _sum: { totalCents: true } });

    const byRep = (await buildReport('by-rep', f)).rows;
    const topProducts = (await buildReport('top-products', f)).rows.slice(0, 8);
    const daily = await prisma.$queryRaw<{ day: string; orders: number; total: bigint }[]>`
      SELECT to_char(o."orderDate", 'YYYY-MM-DD') AS day, COUNT(*)::int AS orders, SUM(o."totalCents")::bigint AS total
        FROM orders o WHERE ${orderConds(f)} GROUP BY o."orderDate" ORDER BY o."orderDate"`;
    const series: { day: string; orders: number; totalCents: number }[] = [];
    const dmap = new Map(daily.map((d) => [d.day, d]));
    for (let d = f.from, i = 0; d <= f.to && i < 400; d = addDays(d, 1), i++) {
      const row = dmap.get(d);
      series.push({ day: d, orders: row ? num(row.orders) : 0, totalCents: row ? num(row.total) : 0 });
    }
    const recentOrders = await prisma.order.findMany({
      where: { ...base, status: { not: 'DRAFT' } },
      orderBy: { confirmedAt: 'desc' },
      take: 8,
      select: { id: true, number: true, orderDate: true, status: true, totalCents: true, client: { select: { legalName: true, tradeName: true } }, salesRep: { select: { fullName: true } } },
    });
    const pendingClients = await prisma.client.findMany({
      where: { deletedAt: null, ...(repIds ? repCond : {}), status: { in: ['PENDING_REGISTRATION', 'UNDER_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, legalName: true, cnpj: true, status: true, createdAt: true },
    });

    return {
      filter: f,
      kpis: {
        clients,
        clientsPending,
        activeProducts,
        ordersToday,
        pendingApproval,
        pendingDiscounts,
        picking,
        invoiced,
        shipped,
        completed,
        openQuotes,
        ordersInPeriod: agg._count,
        totalCents: agg._sum.totalCents ?? 0,
        grossCents: agg._sum.grossCents ?? 0,
        discountCents: (agg._sum.itemDiscountCents ?? 0) + (agg._sum.generalDiscountCents ?? 0),
        fulfilledCents: fulfilled._sum.totalCents ?? 0,
      },
      byRep,
      topProducts,
      series,
      recentOrders: recentOrders.map((o) => ({ ...o, orderDate: o.orderDate.toISOString().slice(0, 10) })),
      pendingClients: pendingClients.map((c) => ({ ...c, statusLabel: CLIENT_STATUS_LABELS[c.status] })),
    };
  }
}
