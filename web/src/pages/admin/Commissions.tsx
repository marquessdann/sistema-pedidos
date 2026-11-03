import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Calculator, Download, Info } from 'lucide-react';
import { formatBRL, formatBps, formatDateBR } from '@della/shared';
import { api, apiHref } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { Card, CardTitle, DataTable, ErrorState, Field, Input, Loading, PageHeader, PercentInput, Select, Stat, cx } from '../../components/ui';

interface Line {
  id: string;
  number: string;
  date: string;
  client: string;
  rep: string;
  status: string;
  totalCents: number;
  baseCents: number;
  rateBps: number;
  commissionCents: number;
}
interface Data {
  filter: { from: string; to: string };
  lines: Line[];
  byRep: { rep: string; orders: number; baseCents: number; commissionCents: number; rateBps: number }[];
  totals: { orders: number; baseCents: number; commissionCents: number };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function period(kind: 'this' | 'last') {
  const now = new Date();
  if (kind === 'this') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
}

/** Calculadora de comissão (administrador e gestor). */
export default function Commissions() {
  const nav = useNavigate();
  const { can } = useRole();
  const [preset, setPreset] = useState<'this' | 'last' | 'custom'>('this');
  const [range, setRange] = useState(period('this'));
  const [salesRepId, setRep] = useState('');
  const [basis, setBasis] = useState<'confirmed' | 'fulfilled'>('confirmed');
  const [rateBps, setRate] = useState<number | null>(null);
  const reps = useQuery({ queryKey: ['reps-lite'], queryFn: () => api<{ id: string; fullName: string; commissionBps: number | null }[]>('/admin/reps') });
  const query = { ...range, salesRepId, basis, rateBps: rateBps ?? undefined };
  const q = useQuery({ queryKey: ['commissions', query], queryFn: () => api<Data>('/admin/commissions', { query }), placeholderData: keepPreviousData });
  const rep = reps.data?.find((r) => r.id === salesRepId);
  const chip = (k: typeof preset, label: string) => (
    <button
      type="button"
      onClick={() => {
        setPreset(k);
        if (k !== 'custom') setRange(period(k));
      }}
      className={cx('h-10 rounded-xl border px-4 text-sm font-medium', preset === k ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white text-navy-900')}
    >
      {label}
    </button>
  );

  return (
    <>
      <PageHeader
        title="Comissões"
        subtitle="Calculadora de comissão por período e vendedor"
        actions={
          <a href={apiHref('/admin/commissions', { ...query, format: 'csv' })} className="inline-flex h-11 items-center gap-2 rounded-lg bg-gold-500 px-4 text-sm font-medium text-white hover:bg-gold-600 sm:h-10">
            <Download className="size-4" /> Exportar CSV
          </a>
        }
      />
      <Card className="mb-5">
        <div className="flex flex-wrap gap-2">
          {chip('this', 'Este mês')}
          {chip('last', 'Mês passado')}
          {chip('custom', 'Escolher datas')}
        </div>
        {preset === 'custom' && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
            <Field label="De"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
            <Field label="Até"><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Vendedor">
            <Select value={salesRepId} onChange={(e) => setRep(e.target.value)}>
              <option value="">Todos</option>
              {reps.data?.map((r) => <option key={r.id} value={r.id}>{r.fullName}{r.commissionBps != null ? ` (${formatBps(r.commissionBps, 0)})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Pedidos considerados">
            <Select value={basis} onChange={(e) => setBasis(e.target.value as 'confirmed')}>
              <option value="confirmed">Todos os confirmados</option>
              <option value="fulfilled">Somente faturados (enviados/entregues)</option>
            </Select>
          </Field>
          <Field label="Simular outra % (opcional)" hint={rep?.commissionBps != null ? `Cadastro: ${formatBps(rep.commissionBps)}` : 'Vazio = % do cadastro de cada vendedor'}>
            <PercentInput value={rateBps} onChange={setRate} placeholder="Cadastro" />
          </Field>
        </div>
      </Card>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        q.data && (
          <div className={cx('space-y-5', q.isFetching && 'opacity-70')}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Pedidos" value={q.data.totals.orders} hint={`${formatDateBR(q.data.filter.from)} a ${formatDateBR(q.data.filter.to)}`} icon={<Calculator className="size-5" />} />
              <Stat label="Base de cálculo" value={formatBRL(q.data.totals.baseCents)} hint="Produtos após descontos, sem frete" />
              <Stat label="Comissão" value={formatBRL(q.data.totals.commissionCents)} tone="gold" hint={rateBps != null ? `Simulação com ${formatBps(rateBps)}` : 'Pela % do cadastro'} />
            </div>
            {q.data.byRep.length > 1 && (
              <Card>
                <CardTitle>Por vendedor</CardTitle>
                <ul className="divide-y divide-line text-sm">
                  {q.data.byRep.map((r) => (
                    <li key={r.rep} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span className="font-medium">{r.rep}</span>
                      <span className="text-muted">{r.orders} pedido(s) • base {formatBRL(r.baseCents)}</span>
                      <span className="font-semibold tabular text-gold-700">{formatBRL(r.commissionCents)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card padded={false}>
              <div className="p-5 pb-3"><CardTitle className="mb-0">Pedidos</CardTitle></div>
              <DataTable
                rows={q.data.lines}
                rowKey={(r) => r.id}
                onRowClick={can('canViewSales') ? (r) => nav(`/admin/pedidos/${r.id}`) : undefined}
                empty={<p className="px-5 py-10 text-center text-sm text-muted">Nenhum pedido no período.</p>}
                mobileCard={(r) => (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-navy-900">{r.number}</p>
                      <p className="truncate text-sm">{r.client}</p>
                      <p className="text-xs text-muted">{formatDateBR(r.date)} • {r.rep} • {r.status}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted">base {formatBRL(r.baseCents)}</p>
                      <p className="font-semibold tabular text-gold-700">{formatBRL(r.commissionCents)}</p>
                      <p className="text-xs text-muted">{formatBps(r.rateBps)}</p>
                    </div>
                  </div>
                )}
                columns={[
                  { key: 'n', header: 'Pedido', render: (r) => <span className="font-medium text-navy-900">{r.number}</span> },
                  { key: 'd', header: 'Data', render: (r) => formatDateBR(r.date) },
                  { key: 'c', header: 'Cliente', render: (r) => <span className="block max-w-56 truncate">{r.client}</span> },
                  { key: 'r', header: 'Vendedor', render: (r) => r.rep },
                  { key: 's', header: 'Status', render: (r) => r.status },
                  { key: 't', header: 'Valor do pedido', align: 'right', render: (r) => formatBRL(r.totalCents) },
                  { key: 'b', header: 'Base', align: 'right', render: (r) => formatBRL(r.baseCents) },
                  { key: 'p', header: '%', align: 'right', render: (r) => formatBps(r.rateBps) },
                  { key: 'm', header: 'Comissão', align: 'right', render: (r) => <span className="font-semibold text-gold-700">{formatBRL(r.commissionCents)}</span> },
                ]}
              />
            </Card>
            <p className="flex items-start gap-2 text-xs text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" /> Base da comissão = valor dos produtos depois dos descontos (sem frete e sem acréscimos). Pedidos cancelados, reprovados e rascunhos não entram.
            </p>
          </div>
        )
      )}
    </>
  );
}
