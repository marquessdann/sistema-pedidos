import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatDateTimeBR } from '@della/shared';
import { api } from '../../lib/api';
import { AUDIT_LABELS } from '../../lib/labels';
import { Card, DataTable, Input, PageHeader, Pagination, Select } from '../../components/ui';

const ENTITIES: Record<string, string> = { order: 'Pedido', quote: 'Orçamento', client: 'Cliente', product: 'Produto', sales_rep: 'Vendedor', user: 'Usuário', company_settings: 'Configurações', pricing_rule: 'Regra de preço', brand: 'Marca', category: 'Categoria', payment_term: 'Condição de pagamento' };

export default function Audit() {
  const [params] = useSearchParams();
  const [f, setF] = useState({ entity: params.get('entity') ?? '', entityId: params.get('entityId') ?? '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['audit', f, page], queryFn: () => api<any>('/admin/audit', { query: { ...f, page, pageSize: 50 } }), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Auditoria" subtitle="Registro imutável das operações importantes (somente leitura)" />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-line p-4 md:grid-cols-4">
          <Select value={f.entity} onChange={(e) => { setF({ ...f, entity: e.target.value, entityId: '' }); setPage(1); }} aria-label="Entidade">
            <option value="">Todas as entidades</option>
            {Object.entries(ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input placeholder="Ação (ex.: PRICE, LOGIN)" value={f.action} onChange={(e) => { setF({ ...f, action: e.target.value }); setPage(1); }} />
          <Input type="date" aria-label="De" value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setPage(1); }} />
          <Input type="date" aria-label="Até" value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setPage(1); }} />
        </div>
        <DataTable rows={list.data?.items} loading={list.isFetching} rowKey={(r: any) => r.id}
          columns={[
            { key: 'd', header: 'Data/hora', render: (r: any) => <span className="whitespace-nowrap">{formatDateTimeBR(r.createdAt)}</span> },
            { key: 'u', header: 'Usuário', render: (r: any) => r.user?.name ?? '—' },
            { key: 'a', header: 'Operação', render: (r: any) => AUDIT_LABELS[r.action] ?? r.action },
            { key: 'e', header: 'Registro', hideOnMobile: true, render: (r: any) => `${ENTITIES[r.entity] ?? r.entity}${r.data?.number ? ` ${r.data.number}` : r.data?.sku ? ` ${r.data.sku}` : ''}` },
            { key: 'x', header: 'Detalhes', hideOnMobile: true, render: (r: any) => r.data ? <details><summary className="cursor-pointer text-xs text-navy-700">ver dados</summary><pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap text-[11px] text-muted">{JSON.stringify(r.data, null, 2)}</pre></details> : '—' },
            { key: 'ip', header: 'IP', hideOnMobile: true, render: (r: any) => <span className="text-xs text-muted">{r.ip ?? '—'}</span> },
          ]} />
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
