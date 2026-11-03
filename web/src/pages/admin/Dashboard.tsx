import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  BadgePercent,
  CalendarDays,
  ClipboardCheck,
  FileText,
  PackageCheck,
  PackageSearch,
  Truck,
  UserPlus,
  Users,
  Wallet,
  Boxes,
  CheckCircle2,
  Receipt,
} from 'lucide-react';
import { ORDER_STATUS_LABELS, formatBRL, formatCnpj, formatDateBR, type OrderStatus } from '@della/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Card, CardTitle, ErrorState, Field, Input, Loading, PageHeader, Select, Stat, cx } from '../../components/ui';
import { ClientStatusBadge, OrderStatusBadge } from '../../components/common';

interface Dash {
  filter: { from: string; to: string };
  kpis: Record<string, number>;
  byRep: { rep: string; orders: number; total: number; fulfilled: number }[];
  topProducts: { sku: string; product: string; brand: string; qty: number; net: number }[];
  series: { day: string; orders: number; totalCents: number }[];
  recentOrders: { id: string; number: string; orderDate: string; status: string; totalCents: number; client: { legalName: string; tradeName: string | null }; salesRep: { fullName: string } }[];
  pendingClients: { id: string; legalName: string; cnpj: string; status: string }[];
}

/** Barras verticais de série única (valor por dia), com tooltip por barra. */
function DailyBars({ series }: { series: Dash['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...series.map((s) => s.totalCents), 1);
  const W = 640;
  const H = 180;
  const pad = { l: 8, r: 8, t: 12, b: 22 };
  const bw = (W - pad.l - pad.r) / series.length;
  const barW = Math.max(2, Math.min(18, bw - 2));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const h = hover !== null ? series[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full" role="img" aria-label="Valor de pedidos por dia no período">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#e2e6ec" strokeDasharray="3 4" strokeWidth={1} />
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#cbd2dc" />
        {series.map((s, i) => {
          const x = pad.l + i * bw + (bw - barW) / 2;
          const top = y(s.totalCents);
          const height = H - pad.b - top;
          return (
            <g key={s.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {s.totalCents > 0 && (
                <path
                  d={`M${x},${H - pad.b} V${top + Math.min(4, height)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${H - pad.b} Z`}
                  fill={hover === i ? '#b8913a' : '#1b2e55'}
                />
              )}
            </g>
          );
        })}
        {series.length > 0 && (
          <>
            <text x={pad.l} y={H - 6} fontSize={10} fill="#5b6575">
              {formatDateBR(series[0].day)}
            </text>
            <text x={W - pad.r} y={H - 6} fontSize={10} fill="#5b6575" textAnchor="end">
              {formatDateBR(series[series.length - 1].day)}
            </text>
          </>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg" style={{ left: `${Math.min(80, ((hover! + 0.5) / series.length) * 100)}%` }}>
          <p className="font-semibold text-navy-900">{formatDateBR(h.day)}</p>
          <p className="tabular text-ink">{formatBRL(h.totalCents)}</p>
          <p className="text-muted">
            {h.orders} pedido{h.orders === 1 ? '' : 's'}
          </p>
        </div>
      )}
    </div>
  );
}

function HBars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${formatBRL(r.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{r.label}</span>
            <span className="shrink-0 tabular font-medium text-navy-900">{formatBRL(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-navy-700" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          {r.sub && <p className="mt-0.5 text-xs text-muted">{r.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const [filter, setFilter] = useState({ from: '', to: '', salesRepId: '', clientId: '', status: '' });
  const reps = useQuery({ queryKey: ['reps'], queryFn: () => api<{ id: string; fullName: string }[]>('/admin/reps') });
  const clients = useQuery({ queryKey: ['clients-all'], queryFn: () => api<{ items: { id: string; legalName: string }[] }>('/admin/clients', { query: { pageSize: 200 } }) });
  const q = useQuery({ queryKey: ['dashboard', filter], queryFn: () => api<Dash>('/admin/dashboard', { query: filter }) });
  const d = q.data;
  const k = d?.kpis;

  return (
    <>
      <PageHeader title={`Olá, ${me?.user.name.split(' ')[0] ?? ''}`} subtitle="Visão geral comercial da Della" />

      <Card className="mb-6 py-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Field label="De">
            <Input type="date" value={filter.from || d?.filter.from || ''} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
          </Field>
          <Field label="Até">
            <Input type="date" value={filter.to || d?.filter.to || ''} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
          </Field>
          <Field label="Representante">
            <Select value={filter.salesRepId} onChange={(e) => setFilter({ ...filter, salesRepId: e.target.value })}>
              <option value="">Todos</option>
              {reps.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cliente">
            <Select value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value })}>
              <option value="">Todos</option>
              {clients.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">Todos (exceto rascunho)</option>
              {Object.entries(ORDER_STATUS_LABELS)
                .filter(([s]) => s !== 'DRAFT')
                .map(([s, l]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      </Card>

      {q.isLoading && <Loading />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && k && (
        <div className={cx('space-y-6 transition-opacity', q.isFetching && 'opacity-70')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Valor dos pedidos no período" value={formatBRL(k.totalCents)} hint={`${k.ordersInPeriod} pedido${k.ordersInPeriod === 1 ? "" : "s"} • faturado ${formatBRL(k.fulfilledCents)}`} icon={<Wallet className="size-5" />} tone="gold" />
            <Stat label="Pedidos realizados hoje" value={k.ordersToday} icon={<CalendarDays className="size-5" />} to="/admin/pedidos" />
            <Stat label="Aguardando aprovação" value={k.pendingApproval} hint={k.pendingDiscounts ? `${k.pendingDiscounts} desconto(s) para decidir` : undefined} icon={<ClipboardCheck className="size-5" />} tone="amber" to="/admin/aprovacoes" />
            <Stat label="Descontos concedidos" value={formatBRL(k.discountCents)} hint={k.grossCents ? `sobre ${formatBRL(k.grossCents)} bruto` : undefined} icon={<BadgePercent className="size-5" />} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Em separação" value={k.picking} hint="Aguardando separação, separando e aguardando expedição" icon={<PackageSearch className="size-5" />} to="/admin/pedidos?status=AWAITING_PICKING,PICKING,AWAITING_SHIPMENT" />
            <Stat label="Faturados" value={k.invoiced} hint="Nota emitida, aguardando envio" icon={<Receipt className="size-5" />} tone="gold" to="/admin/pedidos?status=INVOICED" />
            <Stat label="Em rota" value={k.shipped} hint="Enviados e em rota de entrega" icon={<Truck className="size-5" />} to="/admin/pedidos?status=SHIPPED,OUT_FOR_DELIVERY" />
            <Stat label="Concluídos no período" value={k.completed} hint="Entregues e concluídos" icon={<CheckCircle2 className="size-5" />} tone="green" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Orçamentos em aberto" value={k.openQuotes} icon={<FileText className="size-5" />} to="/admin/orcamentos" />
            <Stat label="Clientes cadastrados" value={k.clients} icon={<Users className="size-5" />} to="/admin/clientes" />
            <Stat label="Pendência cadastral" value={k.clientsPending} hint="Cadastros aguardando aprovação" icon={<UserPlus className="size-5" />} tone={k.clientsPending ? 'amber' : 'navy'} to="/admin/pendencias" />
            <Stat label="Produtos ativos" value={k.activeProducts} icon={<Boxes className="size-5" />} to="/admin/produtos" />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardTitle>Valor de pedidos por dia</CardTitle>
              <DailyBars series={d.series} />
            </Card>
            <Card>
              <CardTitle>Vendas por representante</CardTitle>
              {d.byRep.length ? (
                <HBars rows={d.byRep.map((r) => ({ label: r.rep, value: r.total, sub: `${r.orders} pedido(s) • faturado ${formatBRL(r.fulfilled)}` }))} />
              ) : (
                <p className="text-sm text-muted">Sem pedidos no período.</p>
              )}
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card padded={false} className="xl:col-span-2">
              <div className="flex items-center justify-between p-5 pb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-navy-900">Pedidos recentes</h3>
                <Link to="/admin/pedidos" className="text-sm text-navy-700 hover:underline">
                  Ver todos
                </Link>
              </div>
              {d.recentOrders.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted">Nenhum pedido ainda.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentOrders.map((o) => (
                    <li key={o.id}>
                      <Link to={`/admin/pedidos/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-navy-50/40">
                        <span className="w-40 whitespace-nowrap font-medium text-navy-900">{o.number}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{o.client.tradeName ?? o.client.legalName}</span>
                        <span className="hidden text-sm text-muted md:inline">{o.salesRep.fullName}</span>
                        <OrderStatusBadge status={o.status} />
                        <span className="w-28 text-right text-sm font-medium tabular">{formatBRL(o.totalCents)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <div className="space-y-6">
              <Card>
                <CardTitle icon={<PackageCheck className="size-4" />}>Produtos mais vendidos</CardTitle>
                {d.topProducts.length ? (
                  <ol className="space-y-2.5">
                    {d.topProducts.slice(0, 6).map((p, i) => (
                      <li key={p.sku} className="flex items-center gap-3 text-sm">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-50 text-xs font-semibold text-navy-700">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-ink">{p.product}</span>
                          <span className="text-xs text-muted">
                            {p.sku} • {p.brand}
                          </span>
                        </span>
                        <span className="shrink-0 text-right tabular">
                          <span className="block font-medium">{p.qty} un.</span>
                          <span className="text-xs text-muted">{formatBRL(p.net)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted">Sem vendas no período.</p>
                )}
              </Card>
              <Card>
                <CardTitle icon={<AlertCircle className="size-4" />}>Clientes aguardando liberação</CardTitle>
                {d.pendingClients.length ? (
                  <ul className="space-y-2">
                    {d.pendingClients.map((c) => (
                      <li key={c.id}>
                        <Link to={`/admin/clientes/${c.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-navy-50">
                          <span className="min-w-0">
                            <span className="block truncate">{c.legalName}</span>
                            <span className="text-xs text-muted">{formatCnpj(c.cnpj)}</span>
                          </span>
                          <ClientStatusBadge status={c.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Nenhum cliente pendente.</p>
                )}
              </Card>
            </div>
          </div>
          <p className="text-xs text-muted">
            Valores consideram pedidos confirmados (não incluem rascunhos, cancelados, reprovados nem orçamentos). “Faturado” = pedidos enviados, entregues ou concluídos. Período: {formatDateBR(d.filter.from)} a {formatDateBR(d.filter.to)}.
            {filter.status && ` Status: ${ORDER_STATUS_LABELS[filter.status as OrderStatus]}.`}
          </p>
        </div>
      )}
    </>
  );
}
