import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { QUOTE_STATUS_LABELS, formatBRL, formatCnpj, formatDateBR } from '@della/shared';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Card, DataTable, ErrorState, Input, LinkButton, PageHeader, Pagination, Select } from '../../components/ui';
import { ApprovalBadge, QuoteStatusBadge } from '../../components/common';

export default function SellerQuotes() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const clientId = params.get('cliente') ?? '';
  const [f, setF] = useState({ q: '', from: '', to: '', status: '' });
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(1);
  const df = useDebounced(f, 350);
  const list = useQuery({ queryKey: ['seller-quotes', df, clientId, sort, page], queryFn: () => api<any>('/seller/quotes', { query: { ...df, clientId, sort, page } }), placeholderData: keepPreviousData });
  const upd = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <PageHeader title="Orçamentos" subtitle="Propostas comerciais: consulte, duplique e transforme em pedido" actions={clientId && <LinkButton to={`/vendedor/novo-orcamento?cliente=${clientId}`} variant="primary" icon={<Plus className="size-4" />}>Novo orçamento</LinkButton>} />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-line p-4 md:grid-cols-[1fr_150px_150px_220px]">
          <Input placeholder="Número, cliente ou CNPJ" value={f.q} onChange={(e) => upd('q', e.target.value)} />
          <Input type="date" aria-label="De" value={f.from} onChange={(e) => upd('from', e.target.value)} />
          <Input type="date" aria-label="Até" value={f.to} onChange={(e) => upd('to', e.target.value)} />
          <Select value={f.status} onChange={(e) => upd('status', e.target.value)} aria-label="Status">
            <option value="">Todos os status</option>
            {Object.entries(QUOTE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : (
          <DataTable rows={list.data?.items} loading={list.isFetching} rowKey={(r: any) => r.id} sort={sort} onSort={setSort} onRowClick={(r: any) => nav(`/vendedor/orcamentos/${r.id}`)}
            columns={[
              { key: 'n', header: 'Orçamento', sortKey: 'number', render: (r: any) => <span className="font-medium text-navy-900">{r.number}</span> },
              { key: 'd', header: 'Data', sortKey: 'date', render: (r: any) => formatDateBR(r.quoteDate) },
              { key: 'v', header: 'Validade', hideOnMobile: true, render: (r: any) => formatDateBR(r.validUntil) },
              { key: 'c', header: 'Cliente', render: (r: any) => (<div className="max-w-60"><p className="truncate">{r.client.tradeName ?? r.client.legalName}</p><p className="text-xs text-muted">{formatCnpj(r.client.cnpj)}</p></div>) },
              { key: 'i', header: 'Itens', align: 'right', hideOnMobile: true, render: (r: any) => r._count.items },
              { key: 't', header: 'Valor', align: 'right', sortKey: 'total', render: (r: any) => <span className="font-medium">{formatBRL(r.totalCents)}</span> },
              { key: 's', header: 'Status', render: (r: any) => (<div className="flex flex-col items-start gap-1"><QuoteStatusBadge status={r.status} />{r.convertedOrder && <span className="text-xs text-muted">→ {r.convertedOrder.number}</span>}<ApprovalBadge status={r.discountApprovalStatus} /></div>) },
            ]} />
        )}
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
