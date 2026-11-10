import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { formatBRL } from '@della/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDebounced } from '../../lib/hooks';
import { Card, EmptyState, Input, Loading, PageHeader, Select, cx } from '../../components/ui';
import { ProductThumb } from '../../components/common';

export default function Catalog() {
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [brandId, setBrand] = useState('');
  const [categoryId, setCat] = useState('');
  const dq = useDebounced(q);
  const brands = useQuery({ queryKey: ['seller-brands'], queryFn: () => api<{ id: string; name: string }[]>('/seller/brands') });
  const cats = useQuery({ queryKey: ['seller-cats'], queryFn: () => api<{ id: string; name: string }[]>('/seller/categories') });
  const cat = useQuery({ queryKey: ['seller-catalog', dq, brandId, categoryId, false], queryFn: () => api<any>('/seller/catalog', { query: { q: dq, brandId, categoryId } }), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Catálogo" subtitle="Produtos e preços comerciais autorizados, organizados por marca" />
      <Card className="mb-6 py-4">
        <div className="grid gap-3 md:grid-cols-[1fr_200px_200px]">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input className="pl-9" placeholder="Nome ou código do produto" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select value={brandId} onChange={(e) => setBrand(e.target.value)} aria-label="Marca"><option value="">Todas as marcas</option>{brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
          <Select value={categoryId} onChange={(e) => setCat(e.target.value)} aria-label="Categoria"><option value="">Todas as categorias</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </div>
      </Card>
      {cat.isLoading ? <Loading /> : cat.data?.brands.length === 0 ? <Card><EmptyState title="Nenhum produto encontrado" /></Card> : (
        <div className={cx('space-y-8', cat.isFetching && 'opacity-70')}>
          {cat.data?.brands.map((b: any) => (
            <section key={b.id}>
              <div className="mb-3 flex items-center gap-3"><h2 className="text-lg font-semibold text-navy-900">{b.name}</h2><span className="h-px flex-1 bg-gradient-to-r from-gold-300 to-transparent" /></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {b.products.map((p: any) => (
                  <Card key={p.id} padded={false} className="overflow-hidden">
                    <div className="bg-slate-50 p-3"><ProductThumb fileName={p.imageFileName} alt={p.name} size="lg" /></div>
                    <div className="p-4">
                      <p className="font-medium text-navy-900">{p.name}</p>
                      <p className="text-xs text-muted">{p.sku}{p.category ? ` • ${p.category.name}` : ''}</p>
                      {p.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</p>}
                      {p.boxOnly && p.unitsPerBox > 1 ? (
                        <p className="mt-2 text-lg font-semibold tabular text-navy-900">{formatBRL(p.priceCents * p.unitsPerBox)} <span className="text-xs font-normal text-muted">/caixa ({p.unitsPerBox} {p.unit})</span></p>
                      ) : (
                        <p className="mt-2 text-lg font-semibold tabular text-navy-900">{formatBRL(p.priceCents)} <span className="text-xs font-normal text-muted">/{p.unit}</span></p>
                      )}
                      {me?.rep?.canViewCost && p.costCents != null && <p className="text-xs text-muted">Custo: {formatBRL(p.costCents)}</p>}
                      {cat.data.stockEnabled && p.availableQty !== null && (() => {
                        const box = p.boxOnly && p.unitsPerBox > 1 ? p.unitsPerBox : 0;
                        const n = box ? Math.floor(p.availableQty / box) : p.availableQty;
                        return <p className={cx('text-xs font-medium', n <= 0 ? 'text-red-600' : 'text-emerald-700')}>{n <= 0 ? 'Sem estoque' : box ? `${n} ${n === 1 ? 'caixa disponível' : 'caixas disponíveis'}` : `${n} disponíveis`}</p>;
                      })()}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
