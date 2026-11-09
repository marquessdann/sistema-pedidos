import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, FileDown, LogOut, MapPin, MessageCircle, Phone, RefreshCw, Truck, User } from 'lucide-react';
import { ORDER_STATUS_LABELS, formatDateBR, formatPhone, type OrderStatus } from '@della/shared';
import { api, apiHref } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Brand } from '../../components/layout/AppShell';
import { OrderProgressSwitches, ProductThumb } from '../../components/common';
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState, Loading, cx } from '../../components/ui';

interface LItem {
  sku: string;
  productName: string;
  brandName: string;
  quantity: number;
  saleUnit: string;
  unitsPerSaleUnit: number;
  unit: string;
  imageFileName: string | null;
}
interface LOrder {
  id: string;
  number: string;
  status: OrderStatus;
  statusLabel: string;
  orderDate: string;
  expectedDelivery: string | null;
  notes: string | null;
  salesRep: { fullName: string };
  client: { name: string; tradeName: string | null; responsible: string | null; phone: string | null; address: string };
  items: LItem[];
  statusHistory: { toStatus: string; createdAt: string; user: { name: string } | null }[];
}

/** Moldura simples da logística: logotipo, nome e "Sair". */
function Shell({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <Link to="/logistica" className="w-28"><Brand variant="plain" /></Link>
          <div className="flex items-center gap-2">
            <span className="text-right text-sm leading-tight">
              <span className="block font-medium text-navy-900">{me?.user.name}</span>
              <span className="block text-xs text-muted">Logística</span>
            </span>
            <Button variant="ghost" size="sm" icon={<LogOut className="size-4" />} onClick={async () => { await logout(); nav('/login'); }}>
              Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5 pb-16">{children}</main>
    </div>
  );
}

const unitText = (i: LItem) => (i.saleUnit === 'CX' ? `caixa${i.quantity > 1 ? 's' : ''} (${i.unitsPerSaleUnit} un cada)` : i.unit);

// ================================================================= Lista
export function LogisticsList() {
  const [tab, setTab] = useState<'todo' | 'route' | 'done'>('todo');
  const q = useQuery({
    queryKey: ['logistics', tab],
    queryFn: () => api<{ items: LOrder[]; counts: { todo: number; route: number; newOnes: number } }>('/logistics/orders', { query: { tab } }),
    refetchInterval: 60_000,
  });
  const c = q.data?.counts;
  const tabs: [typeof tab, string, number | undefined][] = [
    ['todo', 'Para separar', c?.todo],
    ['route', 'Em entrega', c?.route],
    ['done', 'Entregues', undefined],
  ];
  return (
    <Shell>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-navy-900">Separação e entrega</h1>
          {!!c?.newOnes && <p className="mt-1 text-sm font-medium text-amber-700">{c.newOnes} pedido(s) novo(s) chegaram. Marque “Recebido na logística”.</p>}
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className={q.isFetching ? 'size-4 animate-spin' : 'size-4'} />} onClick={() => q.refetch()}>
          Atualizar
        </Button>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {tabs.map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx('rounded-xl border px-2 py-3 text-sm font-semibold', tab === k ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white text-navy-900')}
          >
            {label}
            {n !== undefined && <span className={cx('ml-1.5 rounded-full px-2 py-0.5 text-xs', tab === k ? 'bg-gold-500 text-white' : 'bg-navy-50')}>{n}</span>}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState title={tab === 'todo' ? 'Nenhum pedido para separar' : tab === 'route' ? 'Nenhum pedido em entrega' : 'Nenhum pedido entregue nos últimos 45 dias'} icon={<Truck className="size-6" />} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {q.data.items.map((o) => (
            <li key={o.id}>
              <Link to={`/logistica/${o.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-xs active:bg-navy-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-navy-900">Pedido {o.number}</p>
                    <p className="truncate text-base text-slate-700">{o.client.tradeName || o.client.name}</p>
                  </div>
                  {o.status === 'AWAITING_PICKING' ? <Badge tone="amber">NOVO</Badge> : <Badge tone="violet">{ORDER_STATUS_LABELS[o.status]}</Badge>}
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-sm text-muted">
                  <MapPin className="mt-0.5 size-4 shrink-0" /> {o.client.address || 'Endereço não informado'}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {o.items.length} produto(s) • pedido de {formatDateBR(o.orderDate)}
                  {o.expectedDelivery && ` • entregar até ${formatDateBR(o.expectedDelivery)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

// ================================================================= Detalhe
export function LogisticsOrder() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['logistics-order', id], queryFn: () => api<LOrder>(`/logistics/orders/${id}`), staleTime: 0 });
  const storeKey = `della:separacao:${id}`;
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(checked));
    } catch {
      /* ignore */
    }
  }, [checked, storeKey]);

  if (q.isLoading) return <Shell><Loading /></Shell>;
  if (q.isError || !q.data) return <Shell><ErrorState error={q.error} onRetry={() => q.refetch()} /></Shell>;
  const o = q.data;
  const pdfUrl = apiHref(`/logistics/orders/${o.id}/picking.pdf`);
  const done = o.items.filter((i, k) => checked[`${i.sku}:${i.saleUnit}:${k}`]).length;

  const sharePdf = async () => {
    try {
      const res = await fetch(pdfUrl, { credentials: 'same-origin' });
      if (!res.ok) throw new Error();
      const file = new File([await res.blob()], `separacao-${o.number}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: `Separação do pedido ${o.number}` });
      } else {
        window.open(`${pdfUrl}?download=1`, '_blank');
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast.error('Não foi possível compartilhar o PDF. Use “Abrir PDF”.');
    }
  };

  return (
    <Shell>
      <Link to="/logistica" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700"><ArrowLeft className="size-4" /> Voltar</Link>
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold-600">{o.statusLabel}</p>
        <h1 className="text-2xl font-semibold text-navy-900">Pedido {o.number}</h1>
      </div>

      <Card className="mb-4">
        <CardTitle>Entregar para</CardTitle>
        <p className="text-lg font-semibold text-navy-900">{o.client.tradeName || o.client.name}</p>
        {o.client.tradeName && <p className="text-sm text-muted">{o.client.name}</p>}
        <p className="mt-2 flex items-start gap-2 text-base"><MapPin className="mt-1 size-4 shrink-0 text-muted" /> {o.client.address || 'Endereço não informado'}</p>
        {o.client.responsible && <p className="mt-1 flex items-center gap-2 text-base"><User className="size-4 text-muted" /> {o.client.responsible}</p>}
        {o.client.phone && (
          <a href={`tel:${o.client.phone}`} className="mt-1 flex items-center gap-2 text-base font-medium text-navy-700"><Phone className="size-4" /> {formatPhone(o.client.phone)}</a>
        )}
        <p className="mt-3 text-sm text-muted">
          Vendedor: {o.salesRep.fullName} • Pedido de {formatDateBR(o.orderDate)}
          {o.expectedDelivery && ` • Entregar até ${formatDateBR(o.expectedDelivery)}`}
        </p>
        {o.notes && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><strong>Observação:</strong> {o.notes}</p>}
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <a href={pdfUrl} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-navy-900 px-4 font-medium text-white">
          <FileDown className="size-5" /> Abrir PDF
        </a>
        <Button size="lg" variant="success" icon={<MessageCircle className="size-5" />} onClick={() => void sharePdf()}>
          Enviar PDF
        </Button>
      </div>

      <Card className="mb-4">
        <CardTitle>Etapas</CardTitle>
        <p className="-mt-2 mb-3 text-sm text-muted">Toque na etapa quando terminar. O escritório e o vendedor veem na hora.</p>
        <OrderProgressSwitches
          orderId={o.id}
          status={o.status}
          mode="logistics"
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ['logistics-order', id] });
            void qc.invalidateQueries({ queryKey: ['logistics'] });
          }}
        />
      </Card>

      <Card padded={false}>
        <div className="flex items-center justify-between p-4 pb-2">
          <CardTitle className="mb-0">Produtos para separar</CardTitle>
          <span className={cx('text-sm font-semibold', done === o.items.length ? 'text-emerald-700' : 'text-muted')}>
            {done} de {o.items.length}
          </span>
        </div>
        <ul className="divide-y divide-line">
          {o.items.map((i, k) => {
            const key = `${i.sku}:${i.saleUnit}:${k}`;
            const ok = !!checked[key];
            return (
              <li key={key}>
                <button type="button" onClick={() => setChecked((c) => ({ ...c, [key]: !ok }))} className={cx('flex w-full items-center gap-3 p-4 text-left', ok && 'bg-emerald-50')}>
                  <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg border-2', ok ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300')}>
                    {ok && <Check className="size-5" />}
                  </span>
                  <ProductThumb fileName={i.imageFileName} alt={i.productName} />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block font-medium text-navy-900', ok && 'line-through opacity-60')}>{i.productName}</span>
                    <span className="block text-xs text-muted">{i.brandName} • SKU {i.sku}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-2xl font-bold text-navy-900">{i.quantity}</span>
                    <span className="block text-xs text-muted">{unitText(i)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </Shell>
  );
}
