import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { ORDER_STATUS_LABELS, formatBRL, formatBps, formatDateBR } from '@della/shared';
import { api, qs } from '../../lib/api';
import { Card, ErrorState, Field, Input, Loading, PageHeader, Select, cx } from '../../components/ui';

const REPORTS = [
  ['summary', 'Resumo bruto x líquido'],
  ['orders', 'Pedidos por período'],
  ['by-rep', 'Vendas por vendedor'],
  ['by-client', 'Vendas por cliente'],
  ['top-products', 'Produtos / quantidades por SKU'],
  ['quotes', 'Orçamentos gerados'],
  ['quote-conversion', 'Conversão de orçamentos'],
  ['discounts', 'Descontos concedidos'],
  ['pending', 'Pedidos pendentes'],
  ['cancelled', 'Pedidos cancelados'],
] as const;

function cell(v: unknown, type: string) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return formatBRL(Number(v));
  if (type === 'percent') return formatBps(Number(v));
  if (type === 'date') return formatDateBR(String(v));
  if (type === 'int') return Number(v).toLocaleString('pt-BR');
  return String(v);
}

export default function Reports() {
  const [kind, setKind] = useState<string>('summary');
  const [f, setF] = useState({ from: '', to: '', salesRepId: '', clientId: '', status: '' });
  const reps = useQuery({ queryKey: ['reps'], queryFn: () => api<{ id: string; fullName: string }[]>('/admin/reps') });
  const clients = useQuery({ queryKey: ['clients-all'], queryFn: () => api<{ items: { id: string; legalName: string }[] }>('/admin/clients', { query: { pageSize: 200 } }) });
  const r = useQuery({ queryKey: ['report', kind, f], queryFn: () => api<any>(`/admin/reports/${kind}`, { query: f }), placeholderData: keepPreviousData });
  const statusApplies = ['orders', 'by-rep', 'by-client', 'top-products', 'discounts'].includes(kind);
  return (
    <>
      <PageHeader title="Relatórios" subtitle="Filtre por período, cliente, representante e status; exporte em PDF ou planilha (CSV, abre no Excel)" />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <Card padded={false} className="h-fit p-2">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col">
            {REPORTS.map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)} className={cx('whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm', kind === k ? 'bg-navy-900 text-white' : 'text-ink hover:bg-navy-50')}>{label}</button>
            ))}
          </nav>
        </Card>
        <div className="min-w-0 space-y-4">
          <Card className="py-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <Field label="De"><Input type="date" value={f.from || r.data?.filter.from || ''} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
              <Field label="Até"><Input type="date" value={f.to || r.data?.filter.to || ''} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
              <Field label="Representante">
                <Select value={f.salesRepId} onChange={(e) => setF({ ...f, salesRepId: e.target.value })}><option value="">Todos</option>{reps.data?.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</Select>
              </Field>
              <Field label="Cliente">
                <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}><option value="">Todos</option>{clients.data?.items.map((x) => <option key={x.id} value={x.id}>{x.legalName}</option>)}</Select>
              </Field>
              <Field label="Status">
                <Select value={f.status} disabled={!statusApplies} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Padrão do relatório</option>{Object.entries(ORDER_STATUS_LABELS).filter(([s]) => s !== 'DRAFT').map(([s, l]) => <option key={s} value={s}>{l}</option>)}</Select>
              </Field>
              <div className="flex items-end gap-2">
                <a href={`/api/admin/reports/${kind}${qs({ ...f, format: 'pdf' })}`} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-navy-900 px-3 text-sm font-medium text-white hover:bg-navy-800">
                  <FileText className="size-4" /> PDF
                </a>
                <a href={`/api/admin/reports/${kind}${qs({ ...f, format: 'csv' })}`} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-gold-500 px-3 text-sm font-medium text-white hover:bg-gold-600">
                  <Download className="size-4" /> Planilha
                </a>
              </div>
            </div>
          </Card>
          <Card padded={false}>
            {r.isLoading ? <Loading /> : r.isError ? <ErrorState error={r.error} onRetry={() => r.refetch()} /> : (
              <>
                <div className="border-b border-line p-5">
                  <h2 className="font-semibold text-navy-900">{r.data.title}</h2>
                  <p className="text-sm text-muted">{formatDateBR(r.data.filter.from)} a {formatDateBR(r.data.filter.to)}{r.data.description && ` • ${r.data.description}`}</p>
                </div>
                <div className={cx('overflow-x-auto', r.isFetching && 'opacity-60')}>
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-line bg-slate-50/70">{r.data.columns.map((c: any) => <th key={c.key} className={cx('px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted', ['money', 'int', 'percent'].includes(c.type) ? 'text-right' : 'text-left')}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {r.data.rows.map((row: any, i: number) => (
                        <tr key={i} className="border-b border-line/60">{r.data.columns.map((c: any) => <td key={c.key} className={cx('px-4 py-2.5', ['money', 'int', 'percent'].includes(c.type) && 'text-right tabular')}>{cell(row[c.key], c.type)}</td>)}</tr>
                      ))}
                      {r.data.rows.length === 0 && <tr><td colSpan={r.data.columns.length} className="px-4 py-10 text-center text-muted">Sem dados para os filtros selecionados.</td></tr>}
                    </tbody>
                    {r.data.totals && r.data.rows.length > 0 && (
                      <tfoot><tr className="bg-navy-50 font-semibold text-navy-900">{r.data.columns.map((c: any) => <td key={c.key} className={cx('px-4 py-3', ['money', 'int', 'percent'].includes(c.type) && 'text-right tabular')}>{r.data.totals[c.key] !== undefined ? cell(r.data.totals[c.key], typeof r.data.totals[c.key] === 'string' ? 'text' : c.type) : ''}</td>)}</tr></tfoot>
                    )}
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
