import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { QUOTE_STATUS_LABELS, formatBRL, formatCnpj, formatDateBR } from '@della/shared';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Card, DataTable, ErrorState, Input, PageHeader, Pagination, Select } from '../../components/ui';
import { ApprovalBadge, QuoteStatusBadge } from '../../components/common';

export default function AdminQuotes() {
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', from: '', to: '', status: '', salesRepId: '' });
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(1);
  const df = useDebounced(f, 350);
  const reps = useQuery({ queryKey: ['reps'], queryFn: () => api<{ id: string; fullName: string }[]>('/admin/reps') });
  const list = useQuery({ queryKey: ['admin-quotes', df, sort, page], queryFn: () => api<any>('/admin/quotes', { query: { ...df, sort, page } }), placeholderData: keepPreviousData });
  const upd = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title="Orçamentos" subtitle="Propostas comerciais (não representam vendas realizadas)" />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-line p-4 md:grid-cols-[1fr_150px_150px_200px_200px]">
          <Input placeholder="Número, cliente ou CNPJ" value={f.q} onChange={(e) => upd('q', e.target.value)} />
          <Input type="date" aria-label="De" value={f.from} onChange={(e) => upd('from', e.target.value)} />
          <Input type="date" aria-label="Até" value={f.to} onChange={(e) => upd('to', e.target.value)} />
          <Select value={f.status} onChange={(e) => upd('status', e.target.value)} aria-label="Status">
            <option value="">Todos os status</option>
            {Object.entries(QUOTE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={f.salesRepId} onChange={(e) => upd('salesRepId', e.target.value)} aria-label="Vendedor">
            <option value="">Todos os vendedores</option>
            {reps.data?.map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
          </Select>
        </div>
        {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
          <DataTable
            rows={list.data?.items}
            loading={list.isFetching}
            rowKey={(r: any) => r.id}
            sort={sort}
            onSort={setSort}
            onRowClick={(r: any) => nav(`/admin/orcamentos/${r.id}`)}
            mobileCard={(r: any) => (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-900">{r.number}</p>
                  <p className="truncate text-sm">{r.client.tradeName ?? r.client.legalName}</p>
                  <p className="text-xs text-muted">{formatDateBR(r.quoteDate)} • válido até {formatDateBR(r.validUntil)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular">{formatBRL(r.totalCents)}</span>
                  <QuoteStatusBadge status={r.status} />
                  {r.convertedOrder && <span className="text-xs text-muted">→ {r.convertedOrder.number}</span>}
                </div>
              </div>
            )}
            columns={[
              { key: 'number', header: 'Orçamento', sortKey: 'number', render: (r: any) => <span className="font-medium text-navy-900">{r.number}</span> },
              { key: 'date', header: 'Data', sortKey: 'date', render: (r: any) => formatDateBR(r.quoteDate) },
              { key: 'valid', header: 'Validade', hideOnMobile: true, render: (r: any) => formatDateBR(r.validUntil) },
              { key: 'client', header: 'Cliente', render: (r: any) => (<div className="max-w-64"><p className="truncate">{r.client.legalName}</p><p className="text-xs text-muted">{formatCnpj(r.client.cnpj)}</p></div>) },
              { key: 'rep', header: 'Vendedor', hideOnMobile: true, render: (r: any) => r.salesRep.fullName },
              { key: 'total', header: 'Valor', align: 'right', sortKey: 'total', render: (r: any) => formatBRL(r.totalCents) },
              { key: 'status', header: 'Status', render: (r: any) => (<div className="flex flex-col items-start gap-1"><QuoteStatusBadge status={r.status} />{r.convertedOrder && <span className="text-xs text-muted">→ {r.convertedOrder.number}</span>}<ApprovalBadge status={r.discountApprovalStatus} /></div>) },
            ]}
          />
        )}
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
