import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatBRL, formatCnpj, formatDateBR } from '@della/shared';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Card, DataTable, ErrorState, PageHeader, Pagination } from '../../components/ui';
import { ApprovalBadge, OrderStatusBadge } from '../../components/common';
import { OrderFilters, emptyOrderFilter } from '../../components/docs';

export default function AdminOrders() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState({ ...emptyOrderFilter, status: params.get('status') ?? '' });
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(1);
  const f = useDebounced(filter, 350);
  const list = useQuery({
    queryKey: ['admin-orders', f, sort, page],
    queryFn: () => api<any>('/admin/orders', { query: { ...f, sort, page } }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Pedidos" subtitle="Todos os pedidos de todos os representantes" />
      <Card padded={false}>
        <OrderFilters scope="admin" showRep value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <DataTable
            rows={list.data?.items}
            loading={list.isFetching}
            rowKey={(r: any) => r.id}
            sort={sort}
            onSort={setSort}
            onRowClick={(r: any) => nav(`/admin/pedidos/${r.id}`)}
            columns={[
              { key: 'number', header: 'Pedido', sortKey: 'number', render: (r: any) => <span className="font-medium text-navy-900">{r.number ?? 'Rascunho'}</span> },
              { key: 'date', header: 'Data', sortKey: 'date', render: (r: any) => formatDateBR(r.orderDate) },
              { key: 'client', header: 'Cliente', render: (r: any) => (<div className="max-w-64"><p className="truncate">{r.client.legalName}</p><p className="text-xs text-muted">{formatCnpj(r.client.cnpj)}</p></div>) },
              { key: 'rep', header: 'Vendedor', hideOnMobile: true, render: (r: any) => r.salesRep.fullName },
              { key: 'items', header: 'Itens', align: 'right', hideOnMobile: true, render: (r: any) => r._count.items },
              { key: 'sub', header: 'Subtotal', align: 'right', hideOnMobile: true, render: (r: any) => formatBRL(r.grossCents) },
              { key: 'disc', header: 'Desconto', align: 'right', hideOnMobile: true, render: (r: any) => formatBRL(r.itemDiscountCents + r.generalDiscountCents) },
              { key: 'total', header: 'Valor final', align: 'right', sortKey: 'total', render: (r: any) => <span className="font-medium">{formatBRL(r.totalCents)}</span> },
              { key: 'status', header: 'Status', render: (r: any) => (<div className="flex flex-col items-start gap-1"><OrderStatusBadge status={r.status} /><ApprovalBadge status={r.discountApprovalStatus} /></div>) },
            ]}
          />
        )}
        {list.data && (
          <>
            <div className="flex flex-wrap justify-end gap-6 border-t border-line px-4 py-3 text-sm">
              <span className="text-muted">Bruto filtrado: <strong className="tabular text-ink">{formatBRL(list.data.sums.grossCents)}</strong></span>
              <span className="text-muted">Líquido filtrado: <strong className="tabular text-navy-900">{formatBRL(list.data.sums.totalCents)}</strong></span>
            </div>
            <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
