import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, X } from 'lucide-react';
import { ORDER_STATUS_LABELS, formatBRL, formatBps } from '@della/shared';
import { api } from '../lib/api';
import { Button, Card, CardTitle, Field, Input, MoneyInput, Select, cx } from './ui';
import { ProductThumb } from './common';

export interface DocItem {
  id: string;
  sku: string;
  productName: string;
  brandName: string;
  unit: string;
  saleUnit?: string;
  unitsPerSaleUnit?: number;
  imageFileName: string | null;
  quantity: number;
  unitPriceCents: number;
  discountBps: number;
  discountCents: number;
  grossCents: number;
  netCents: number;
  generalDiscountShareCents: number;
  unitCostCents?: number | null;
}

export function ItemsTable({ items, showCost }: { items: DocItem[]; showCost?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <ul className="divide-y divide-line md:hidden">
        {items.map((i) => (
          <li key={i.id} className="flex gap-3 px-4 py-3">
            <ProductThumb fileName={i.imageFileName} alt={i.productName} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug text-navy-900">{i.productName}</p>
              <p className="text-xs text-muted">{i.sku} • {i.brandName}</p>
              <div className="mt-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted">
                  {i.quantity} {i.unit}
                  {i.saleUnit === 'CX' && (i.unitsPerSaleUnit ?? 1) > 1 && ` (${i.unitsPerSaleUnit} un./cx)`} × {formatBRL(i.unitPriceCents)}
                  {i.discountBps ? ` • −${formatBps(i.discountBps)}` : ''}
                </span>
                <span className="shrink-0 font-semibold tabular">{formatBRL(i.grossCents - i.discountCents)}</span>
              </div>
              {showCost && i.unitCostCents != null && <p className="text-xs text-muted">Custo {formatBRL(i.unitCostCents * i.quantity)}</p>}
            </div>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2 text-left font-semibold">Produto</th>
            <th className="px-3 py-2 text-right font-semibold">Qtd.</th>
            <th className="px-3 py-2 text-right font-semibold">Unitário</th>
            <th className="px-3 py-2 text-right font-semibold">Desc.</th>
            <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
            {showCost && <th className="px-3 py-2 text-right font-semibold">Custo</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-line/60 last:border-0">
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <ProductThumb fileName={i.imageFileName} alt={i.productName} size="sm" />
                  <div className="min-w-0">
                    <p className="font-medium text-navy-900">{i.productName}</p>
                    <p className="text-xs text-muted">
                      {i.sku} • {i.brandName}
                    </p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular whitespace-nowrap">
                {i.quantity} {i.unit}
                {i.saleUnit === 'CX' && (i.unitsPerSaleUnit ?? 1) > 1 && <span className="block text-xs text-muted">{i.unitsPerSaleUnit} un./cx</span>}
              </td>
              <td className="px-3 py-2.5 text-right tabular">{formatBRL(i.unitPriceCents)}</td>
              <td className="px-3 py-2.5 text-right tabular text-muted">{i.discountBps ? formatBps(i.discountBps) : '—'}</td>
              <td className="px-3 py-2.5 text-right font-medium tabular">{formatBRL(i.grossCents - i.discountCents)}</td>
              {showCost && <td className="px-3 py-2.5 text-right tabular text-muted">{i.unitCostCents != null ? formatBRL(i.unitCostCents * i.quantity) : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface DocTotals {
  totalQuantity: number;
  grossCents: number;
  itemDiscountCents: number;
  generalDiscountBps: number;
  generalDiscountCents: number;
  surchargeCents: number;
  freightCents: number;
  totalCents: number;
  calcSnapshot?: { surcharges?: { ruleId: string; name: string; amountCents: number }[]; steps?: string[]; internal?: any } | null;
  costCents?: number | null;
  marginCents?: number | null;
  internalTaxCents?: number;
}

export function TotalsCard({ doc, internal, title = 'Resumo financeiro' }: { doc: DocTotals; internal?: boolean; title?: string }) {
  const rows: [ReactNode, string, string?][] = [['Subtotal bruto', formatBRL(doc.grossCents)]];
  if (doc.itemDiscountCents) rows.push(['Descontos por item', `− ${formatBRL(doc.itemDiscountCents)}`, 'text-red-600']);
  rows.push([`Desconto (${formatBps(doc.generalDiscountBps)})`, `− ${formatBRL(doc.generalDiscountCents)}`, doc.generalDiscountCents ? 'text-red-600' : undefined]);
  if (doc.itemDiscountCents && doc.generalDiscountCents) {
    const pct = doc.grossCents > 0 ? Math.round(((doc.itemDiscountCents + doc.generalDiscountCents) * 10000) / doc.grossCents) : 0;
    rows.push([`Desconto total (${formatBps(pct)})`, `− ${formatBRL(doc.itemDiscountCents + doc.generalDiscountCents)}`, 'text-red-600']);
  }
  for (const s of doc.calcSnapshot?.surcharges ?? []) rows.push([s.name, `+ ${formatBRL(s.amountCents)}`]);
  if (doc.freightCents) rows.push(['Frete', `+ ${formatBRL(doc.freightCents)}`]);
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v, cls], i) => (
          <div key={i} className="flex justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className={cx('tabular', cls)}>{v}</dd>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between rounded-lg bg-navy-900 px-4 py-3 text-white">
          <dt className="text-sm font-medium">Valor final</dt>
          <dd className="text-lg font-semibold tabular">{formatBRL(doc.totalCents)}</dd>
        </div>
      </dl>
      {internal && (
        <div className="mt-5 border-t border-dashed border-line pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gold-700">Informações internas (não visíveis ao cliente)</p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Custo dos produtos</dt><dd className="tabular">{doc.costCents != null ? formatBRL(doc.costCents) : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Tributos estimados</dt><dd className="tabular">{formatBRL(doc.internalTaxCents ?? 0)}</dd></div>
            <div className="flex justify-between font-medium">
              <dt>Margem estimada</dt>
              <dd className={cx('tabular', (doc.marginCents ?? 0) < 0 && 'text-red-600')}>
                {doc.marginCents != null ? formatBRL(doc.marginCents) : '—'}
                {doc.calcSnapshot?.internal?.marginBps != null && ` (${formatBps(doc.calcSnapshot.internal.marginBps, 1)})`}
              </dd>
            </div>
          </dl>
          {!!doc.calcSnapshot?.steps?.length && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-navy-700">Memória de cálculo</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
                {doc.calcSnapshot.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

export interface OrderFilterState {
  from: string;
  to: string;
  number: string;
  q: string;
  clientId: string;
  cnpj: string;
  minCents: number | null;
  maxCents: number | null;
  status: string;
  brandId: string;
  productId: string;
  salesRepId: string;
}
export const emptyOrderFilter: OrderFilterState = { from: '', to: '', number: '', q: '', clientId: '', cnpj: '', minCents: null, maxCents: null, status: '', brandId: '', productId: '', salesRepId: '' };

export function OrderFilters({ value, onChange, scope, showRep }: { value: OrderFilterState; onChange: (v: OrderFilterState) => void; scope: 'admin' | 'seller'; showRep?: boolean }) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof OrderFilterState>(k: K, v: OrderFilterState[K]) => onChange({ ...value, [k]: v });
  const brands = useQuery({ queryKey: [scope, 'brands-lite'], queryFn: () => api<{ id: string; name: string }[]>(scope === 'admin' ? '/admin/brands' : '/seller/brands') });
  const products = useQuery({
    queryKey: [scope, 'products-lite', value.brandId],
    queryFn: async () =>
      scope === 'admin'
        ? (await api<{ items: { id: string; sku: string; name: string }[] }>('/admin/products', { query: { brandId: value.brandId, pageSize: 200 } })).items
        : (await api<{ brands: { products: { id: string; sku: string; name: string }[] }[] }>('/seller/catalog', { query: { brandId: value.brandId } })).brands.flatMap((b) => b.products),
    enabled: open,
  });
  const reps = useQuery({ queryKey: ['reps'], queryFn: () => api<{ id: string; fullName: string }[]>('/admin/reps'), enabled: !!showRep });
  const active = Object.entries(value).filter(([k, v]) => v !== '' && v !== null && k !== 'q').length;

  return (
    <div className="border-b border-line p-4">
      <div className="flex flex-col gap-3 md:flex-row">
        <Input className="md:flex-1" placeholder="Pesquisar por número, cliente ou CNPJ" value={value.q} onChange={(e) => set('q', e.target.value)} />
        <div className="grid grid-cols-2 gap-3 md:flex">
          <Input type="date" aria-label="Data inicial" value={value.from} onChange={(e) => set('from', e.target.value)} />
          <Input type="date" aria-label="Data final" value={value.to} onChange={(e) => set('to', e.target.value)} />
        </div>
        <Select className="md:w-56" value={value.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">Todos os status</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Button variant="secondary" icon={<Filter className="size-4" />} onClick={() => setOpen(!open)}>
          Mais filtros{active ? ` (${active})` : ''}
        </Button>
      </div>
      {open && (
        <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Nº do pedido"><Input value={value.number} onChange={(e) => set('number', e.target.value)} placeholder="PED-2026-…" /></Field>
          <Field label="CNPJ"><Input value={value.cnpj} onChange={(e) => set('cnpj', e.target.value)} /></Field>
          <Field label="Valor mínimo"><MoneyInput value={value.minCents} onChange={(v) => set('minCents', v)} /></Field>
          <Field label="Valor máximo"><MoneyInput value={value.maxCents} onChange={(v) => set('maxCents', v)} /></Field>
          <Field label="Marca">
            <Select value={value.brandId} onChange={(e) => onChange({ ...value, brandId: e.target.value, productId: '' })}>
              <option value="">Todas</option>
              {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Produto">
            <Select value={value.productId} onChange={(e) => set('productId', e.target.value)}>
              <option value="">Todos</option>
              {products.data?.map((p) => <option key={p.id} value={p.id}>{p.sku} – {p.name}</option>)}
            </Select>
          </Field>
          {showRep && (
            <Field label="Representante">
              <Select value={value.salesRepId} onChange={(e) => set('salesRepId', e.target.value)}>
                <option value="">Todos</option>
                {reps.data?.map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
              </Select>
            </Field>
          )}
          <div className="flex items-end">
            <Button variant="ghost" icon={<X className="size-4" />} onClick={() => onChange(emptyOrderFilter)}>Limpar filtros</Button>
          </div>
        </div>
      )}
    </div>
  );
}
