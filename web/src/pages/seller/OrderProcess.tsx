import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { formatBRL, formatDateBR } from '@della/shared';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Card, CardTitle, EmptyState, Input, Loading, PageHeader, cx } from '../../components/ui';
import { OrderStatusBadge, OrderTimeline } from '../../components/common';

export default function OrderProcess() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('pedido');
  const clientId = params.get('cliente') ?? '';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['process-list', dq, clientId], queryFn: () => api<any>('/seller/orders', { query: { q: dq, clientId, pageSize: 50 } }), placeholderData: keepPreviousData });
  const order = useQuery({ queryKey: ['seller-order', selected], queryFn: () => api<any>(`/seller/orders/${selected}`), enabled: !!selected, staleTime: 0, refetchOnMount: 'always' });
  return (
    <>
      <PageHeader title="Processo do pedido" subtitle="Selecione um pedido para acompanhar cada etapa" />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card padded={false}>
          <div className="border-b border-line p-3">
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input className="pl-9" placeholder="Número, cliente ou CNPJ" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
            {list.data?.items.map((o: any) => (
              <li key={o.id}>
                <button onClick={() => setParams((p) => { p.set('pedido', o.id); return p; })} className={cx('w-full px-4 py-3 text-left hover:bg-navy-50/50', selected === o.id && 'bg-navy-50')}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-navy-900">{o.number}</span><OrderStatusBadge status={o.status} /></div>
                  <p className="truncate text-sm text-muted">{o.client.tradeName ?? o.client.legalName}</p>
                  <p className="text-xs text-muted">{formatDateBR(o.orderDate)} • {formatBRL(o.totalCents)}</p>
                </button>
              </li>
            ))}
            {list.data?.items.length === 0 && <li className="p-6 text-center text-sm text-muted">Nenhum pedido confirmado encontrado.</li>}
          </ul>
        </Card>
        <Card>
          {!selected ? (
            <EmptyState title="Selecione um pedido" description="O andamento aparece aqui em forma de linha do tempo." />
          ) : order.isLoading ? (
            <Loading />
          ) : order.data ? (
            <>
              <CardTitle actions={<Link className="text-sm text-navy-700 hover:underline" to={`/vendedor/pedidos/${order.data.id}`}>Ver pedido completo</Link>}>Pedido {order.data.number}</CardTitle>
              <p className="mb-6 text-sm text-muted">{order.data.client.legalName} • {formatBRL(order.data.totalCents)} • Status atual: <OrderStatusBadge status={order.data.status} /></p>
              <OrderTimeline status={order.data.status} history={order.data.statusHistory} />
              <p className="mt-6 text-xs text-muted">O andamento é atualizado pela administração. Em caso de dúvidas, contate o administrador.</p>
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
