import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Plus, Power, Search } from 'lucide-react';
import { formatBRL, formatBps } from '@della/shared';
import { api, errorMessage } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { useDebounced } from '../../lib/hooks';
import { Badge, Button, Card, DataTable, ErrorState, Input, LinkButton, PageHeader, Pagination, Select, cx } from '../../components/ui';
import { ProductThumb } from '../../components/common';

interface P {
  id: string;
  sku: string;
  name: string;
  unit: string;
  priceCents: number;
  costCents: number;
  taxRefBps: number;
  marginBps: number | null;
  stockQty: number;
  active: boolean;
  brand: { id: string; name: string };
  category: { name: string } | null;
  images: { fileName: string }[];
}

export default function Products() {
  const nav = useNavigate();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [params] = useSearchParams();
  const [brandId, setBrand] = useState(params.get('brandId') ?? '');
  const [categoryId, setCat] = useState(params.get('categoryId') ?? '');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api<{ id: string; name: string; productCount: number; active: boolean }[]>('/admin/brands') });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ id: string; name: string }[]>('/admin/categories') });
  const list = useQuery({
    queryKey: ['products', dq, brandId, categoryId, status, sort, page],
    queryFn: () => api<{ items: P[]; total: number; page: number; pages: number }>('/admin/products', { query: { q: dq, brandId, categoryId, status, sort, page } }),
    placeholderData: keepPreviousData,
  });
  const toggle = useMutation({
    mutationFn: (p: P) => api(`/admin/products/${p.id}/active`, { body: { active: !p.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dup = useMutation({
    mutationFn: (p: P) => api<{ id: string }>(`/admin/products/${p.id}/duplicate`, { body: {} }),
    onSuccess: (r) => {
      toast.success('Produto duplicado como inativo. Revise e ative.');
      nav(`/admin/produtos/${r.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <PageHeader
        title={isAdmin ? 'Produtos' : 'Liberar produtos'}
        subtitle={isAdmin ? 'Catálogo, preços, custos e tributos de referência' : 'Ative ou inative produtos no catálogo dos vendedores'}
        actions={isAdmin && <LinkButton to="/admin/produtos/novo" variant="primary" icon={<Plus className="size-4" />}>Novo produto</LinkButton>}
      />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <button onClick={() => { setBrand(''); setPage(1); }} className={cx('whitespace-nowrap rounded-full border px-3 py-1.5 text-sm', !brandId ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white text-ink hover:bg-navy-50')}>
          Todas as marcas
        </button>
        {brands.data?.map((b) => (
          <button key={b.id} onClick={() => { setBrand(b.id); setPage(1); }} className={cx('whitespace-nowrap rounded-full border px-3 py-1.5 text-sm', brandId === b.id ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white text-ink hover:bg-navy-50', !b.active && 'opacity-60')}>
            {b.name} {b.productCount != null && <span className="opacity-60">({b.productCount})</span>}
          </button>
        ))}
      </div>
      <Card padded={false}>
        <div className="grid gap-3 border-b border-line p-4 md:grid-cols-[1fr_200px_160px_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input className="pl-9" placeholder="Nome, código/SKU, marca ou categoria" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Select value={categoryId} onChange={(e) => { setCat(e.target.value); setPage(1); }} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="all">Ativos e inativos</option>
            <option value="active">Somente ativos</option>
            <option value="inactive">Somente inativos</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenação">
            <option value="name">Nome (A-Z)</option>
            <option value="sku">Código</option>
            <option value="price_desc">Maior preço</option>
            <option value="price_asc">Menor preço</option>
            <option value="recent">Mais recentes</option>
          </Select>
        </div>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <DataTable
            rows={list.data?.items}
            loading={list.isFetching}
            rowKey={(r) => r.id}
            onRowClick={isAdmin ? (r) => nav(`/admin/produtos/${r.id}`) : undefined}
            mobileCard={(r) => (
              <div className="flex items-center gap-3">
                <ProductThumb fileName={r.images[0]?.fileName} alt={r.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy-900">{r.name}</p>
                  <p className="text-xs text-muted">{r.sku} • {r.brand.name}</p>
                  {isAdmin && <p className="text-xs text-muted">Custo {formatBRL(r.costCents)} • margem {r.marginBps === null ? '—' : formatBps(r.marginBps, 1)}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular">{formatBRL(r.priceCents)}</span>
                  {isAdmin ? (
                    r.active ? <Badge tone="green">Ativo</Badge> : r.priceCents <= 0 ? <Badge tone="amber">Sem preço</Badge> : <Badge>Inativo</Badge>
                  ) : (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant={r.active ? 'secondary' : 'success'} loading={toggle.isPending && toggle.variables?.id === r.id} onClick={() => toggle.mutate(r)}>
                        {r.active ? 'Inativar' : 'Liberar'}
                      </Button>
                    </span>
                  )}
                </div>
              </div>
            )}
            columns={[
              { key: 'img', header: '', className: 'w-16', render: (r) => <ProductThumb fileName={r.images[0]?.fileName} alt={r.name} size="sm" /> },
              { key: 'name', header: 'Produto', render: (r) => (<div><p className="font-medium text-navy-900">{r.name}</p><p className="text-xs text-muted">{r.sku} • {r.brand.name}{r.category ? ` • ${r.category.name}` : ''}</p></div>) },
              ...(isAdmin
                ? [
                    { key: 'cost', header: 'Custo', align: 'right' as const, hideOnMobile: true, render: (r: P) => formatBRL(r.costCents) },
                    { key: 'tax', header: 'Trib. ref.', align: 'right' as const, hideOnMobile: true, render: (r: P) => formatBps(r.taxRefBps) },
                  ]
                : []),
              { key: 'price', header: 'Preço de venda', align: 'right', render: (r) => <span className="font-medium">{formatBRL(r.priceCents)}</span> },
              ...(isAdmin
                ? [{ key: 'margin', header: 'Margem est.', align: 'right' as const, hideOnMobile: true, render: (r: P) => <span className={cx(r.marginBps !== null && r.marginBps < 0 && 'text-red-600')}>{r.marginBps === null ? '—' : formatBps(r.marginBps, 1)}</span> }]
                : []),
              { key: 'stock', header: 'Estoque', align: 'right', hideOnMobile: true, render: (r) => `${r.stockQty} ${r.unit}` },
              { key: 'status', header: 'Status', render: (r) => (r.active ? <Badge tone="green">Ativo</Badge> : r.priceCents <= 0 ? <Badge tone="amber">Sem preço</Badge> : <Badge>Inativo</Badge>) },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (r) => (
                  <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && <Button size="sm" variant="ghost" title="Duplicar" aria-label="Duplicar" onClick={() => dup.mutate(r)} icon={<Copy className="size-4" />} />}
                    <Button size="sm" variant="ghost" title={r.active ? 'Inativar' : 'Ativar'} aria-label={r.active ? 'Inativar' : 'Ativar'} onClick={() => toggle.mutate(r)} icon={<Power className={cx('size-4', r.active ? 'text-emerald-600' : 'text-slate-400')} />} />
                  </div>
                ),
              },
            ]}
          />
        )}
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
      </Card>
      {isAdmin && <p className="mt-3 text-xs text-muted">Custo, tributo de referência e margem são informações internas: não aparecem para os vendedores nem nos PDFs dos clientes.</p>}
    </>
  );
}
