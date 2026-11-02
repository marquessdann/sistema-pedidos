import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { formatBRL, formatCnpj, formatDateBR } from '@della/shared';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { Card, DataTable, ErrorState, LinkButton, PageHeader, Pagination } from '../../components/ui';
import { ApprovalBadge, OrderStatusBadge } from '../../components/common';
import { OrderFilters, emptyOrderFilter } from '../../components/docs';

export default function SellerOrders() {
  const nav = useNavigate();
  const { me } = useAuth();
  const [params] = useSearchParams();
  const clientId = params.get('cliente') ?? '';
  const [filter, setFilter] = useState({ ...emptyOrderFilter, clientId });
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(1);
  const f = useDebounced(filter, 350);
  const list = useQuery({
    queryKey: ['seller-orders', f, sort, page],
    queryFn: () => api<any>('/seller/orders', { query: { ...f, sort, page, includeDrafts: 'true' } }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Meus pedidos"
        subtitle={me?.rep?.canViewAllOrders ? 'Você tem permissão para consultar pedidos de outros vendedores (somente leitura).' : 'Pedidos e rascunhos registrados por você'}
        actions={clientId && <LinkButton to={`/vendedor/novo-pedido?cliente=${clientId}`} variant="primary" icon={<Plus className="size-4" />}>Novo pedido</LinkButton>}
      />
      <Card padded={false}>
        <OrderFilters scope="seller" value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <DataTable
            rows={list.data?.items}
            loading={list.isFetching}
            rowKey={(r: any) => r.id}
            sort={sort}
            onSort={setSort}
            onRowClick={(r: any) => nav(r.status === 'DRAFT' && !r.readOnly ? `/vendedor/pedidos/${r.id}` : `/vendedor/pedidos/${r.id}`)}
            columns={[
              { key: 'number', header: 'Nº do pedido', sortKey: 'number', render: (r: any) => <span className="font-medium text-navy-900">{r.number ?? 'Rascunho'}</span> },
              { key: 'date', header: 'Data', sortKey: 'date', render: (r: any) => formatDateBR(r.orderDate) },
              { key: 'client', header: 'Cliente', render: (r: any) => (<div className="max-w-60"><p className="truncate">{r.client.tradeName ?? r.client.legalName}</p><p className="text-xs text-muted">{formatCnpj(r.client.cnpj)}</p></div>) },
              { key: 'items', header: 'Itens', align: 'right', hideOnMobile: true, render: (r: any) => r._count.items },
              { key: 'sub', header: 'Subtotal', align: 'right', hideOnMobile: true, render: (r: any) => formatBRL(r.grossCents) },
              { key: 'disc', header: 'Desconto', align: 'right', hideOnMobile: true, render: (r: any) => formatBRL(r.itemDiscountCents + r.generalDiscountCents) },
              { key: 'total', header: 'Valor final', align: 'right', sortKey: 'total', render: (r: any) => <span className="font-medium">{formatBRL(r.totalCents)}</span> },
              { key: 'status', header: 'Status', render: (r: any) => (<div className="flex flex-col items-start gap-1"><OrderStatusBadge status={r.status} /><ApprovalBadge status={r.discountApprovalStatus} />{r.readOnly && <span className="text-xs text-muted">{r.salesRep.fullName}</span>}</div>) },
            ]}
          />
        )}
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
