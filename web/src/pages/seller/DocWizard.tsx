import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  CloudOff,
  BadgePercent,
  CheckCircle2,
  ChevronUp,
  FileText,
  Minus,
  PackageSearch,
  Plus,
  Save,
  Search,
  Send,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { addDays, calculate, checkDiscountLimit, formatBRL, formatBps, formatCnpj, formatDateBR, formatDateTimeBR, type CalcResult, type PricingRule } from '@della/shared';
import { ApiError, api, errorMessage, newKey } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { queueDoc, removeOutbox, workingOffline } from '../../lib/offline';
import { clearSession, useDebounced, useSessionState } from '../../lib/hooks';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Input, Loading, Modal, MoneyInput, PercentInput, Select, Textarea, cx, useConfirm } from '../../components/ui';
import { ProductThumb } from '../../components/common';

type Mode = 'order' | 'quote';
type SaleUnit = 'UN' | 'CX';

interface Line {
  productId: string;
  sku: string;
  name: string;
  brandName: string;
  /** unidade base do produto (UN, KG…) */
  baseUnit: string;
  /** unidades por caixa (null = produto não é vendido por caixa) */
  unitsPerBox: number | null;
  /** vende somente por caixa */
  boxOnly?: boolean;
  saleUnit: SaleUnit;
  imageFileName: string | null;
  /** preço por unidade base */
  basePriceCents: number;
  quantity: number;
  discountBps: number;
}

interface WizardState {
  key: string;
  savedId: string | null;
  clientId: string;
  items: Line[];
  generalDiscountBps: number;
  freightCents: number;
  paymentTermId: string;
  notes: string;
  expectedDelivery: string;
  validUntil: string;
  discountReason: string;
  step: number;
  loadedFrom?: string;
}

interface SellerConfig {
  today: string;
  quoteValidityDays: number;
  allowItemDiscount: boolean;
  allowSellerFreight: boolean;
  stockEnabled: boolean;
  maxDiscountBps: number;
  paymentTerms: { id: string; name: string; days: string | null }[];
  surchargeRules: PricingRule[];
}

interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  unitsPerBox: number | null;
  boxOnly?: boolean;
  description: string | null;
  priceCents: number;
  imageFileName: string | null;
  availableQty: number | null;
  brand: { id: string; name: string };
  category: { id: string; name: string } | null;
}

const factor = (l: Pick<Line, 'saleUnit' | 'unitsPerBox'>) => (l.saleUnit === 'CX' && l.unitsPerBox ? l.unitsPerBox : 1);
const linePrice = (l: Line) => l.basePriceCents * factor(l);
const unitLabel = (l: Pick<Line, 'saleUnit' | 'baseUnit'>) => (l.saleUnit === 'CX' ? 'CX' : l.baseUnit);
const sameLine = (a: Pick<Line, 'productId' | 'saleUnit'>, b: Pick<Line, 'productId' | 'saleUnit'>) => a.productId === b.productId && a.saleUnit === b.saleUnit;

const blank = (clientId: string): WizardState => ({
  key: newKey(),
  savedId: null,
  clientId,
  items: [],
  generalDiscountBps: 0,
  freightCents: 0,
  paymentTermId: '',
  notes: '',
  expectedDelivery: '',
  validUntil: '',
  discountReason: '',
  step: 0,
});

const STEPS = ['Produtos', 'Revisão e condições', 'Confirmar'];

export default function DocWizard({ mode }: { mode: Mode }) {
  const { id: editId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { me } = useAuth();
  const clientParam = params.get('cliente') ?? '';
  const storeKey = `della:wizard3:${mode}:${editId ?? clientParam}`;
  const [s, setS] = useSessionState<WizardState>(storeKey, blank(clientParam));
  const [busy, setBusy] = useState<null | string>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const isQuote = mode === 'quote';
  const docLabel = isQuote ? 'orçamento' : 'pedido';
  const update = (patch: Partial<WizardState>) => setS((p) => ({ ...p, ...patch }));

  const config = useQuery({ queryKey: ['seller-config'], queryFn: () => api<SellerConfig>('/seller/config') });

  // edição de rascunho/orçamento existente
  const existing = useQuery({
    queryKey: [mode, 'edit', editId],
    queryFn: () => api<any>(isQuote ? `/seller/quotes/${editId}` : `/seller/orders/${editId}`),
    enabled: !!editId && s.loadedFrom !== editId,
  });
  useEffect(() => {
    const d = existing.data;
    if (!d || s.loadedFrom === editId) return;
    setS({
      ...blank(d.client.id),
      savedId: d.id,
      loadedFrom: editId,
      items: d.items.map((i: any) => ({
        productId: i.productId,
        sku: i.sku,
        name: i.productName,
        brandName: i.brandName,
        baseUnit: i.saleUnit === 'CX' ? 'UN' : i.unit,
        unitsPerBox: i.saleUnit === 'CX' ? i.unitsPerSaleUnit : null,
        saleUnit: i.saleUnit ?? 'UN',
        imageFileName: i.imageFileName,
        basePriceCents: Math.round(i.unitPriceCents / (i.unitsPerSaleUnit || 1)),
        quantity: i.quantity,
        discountBps: i.discountBps,
      })),
      generalDiscountBps: d.generalDiscountBps,
      freightCents: d.freightCents,
      paymentTermId: d.paymentTermId ?? '',
      notes: d.notes ?? '',
      expectedDelivery: d.expectedDelivery ?? '',
      validUntil: d.validUntil ?? '',
      step: 1,
    });
  }, [existing.data, editId, s.loadedFrom, setS]);

  const client = useQuery({ queryKey: ['seller-client', s.clientId], queryFn: () => api<any>(`/seller/clients/${s.clientId}`), enabled: !!s.clientId });

  useEffect(() => {
    if (isQuote && !s.validUntil && config.data) update({ validUntil: addDays(config.data.today, config.data.quoteValidityDays) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.data, isQuote]);

  // cálculo instantâneo no aparelho (mesmo motor do servidor; o servidor recalcula e valida ao salvar)
  const calc = useMemo<{ result: CalcResult | null; error: string | null }>(() => {
    if (!s.items.length) return { result: null, error: null };
    try {
      return {
        result: calculate({
          items: s.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPriceCents: linePrice(i), discountBps: i.discountBps })),
          generalDiscountBps: s.generalDiscountBps,
          freightCents: s.freightCents,
          rules: config.data?.surchargeRules ?? [],
        }),
        error: null,
      };
    } catch (e) {
      return { result: null, error: (e as Error).message };
    }
  }, [s.items, s.generalDiscountBps, s.freightCents, config.data]);
  const limit = config.data?.maxDiscountBps ?? 0;
  const check = calc.result ? checkDiscountLimit(calc.result, limit) : null;
  const overLimit = !!check && !check.withinLimit;

  if (!s.clientId && !editId) {
    return (
      <Card>
        <EmptyState title="Selecione um cliente primeiro" description={`Para iniciar um ${docLabel}, escolha o cliente na tela inicial.`} action={<Button onClick={() => nav('/vendedor')}>Selecionar cliente</Button>} />
      </Card>
    );
  }
  if (config.isLoading || (editId && existing.isLoading)) return <Loading />;
  if (existing.data && !isQuote && existing.data.status !== 'DRAFT') {
    return <Card><EmptyState title="Este pedido já foi confirmado" description="Pedidos confirmados não podem ser editados." action={<Button onClick={() => nav(`/vendedor/pedidos/${editId}`)}>Ver pedido</Button>} /></Card>;
  }
  const cfg = config.data!;
  const c = client.data;
  if (!isQuote && c && c.canOrder === false) {
    return (
      <Card>
        <EmptyState
          title="Cadastro do cliente aguardando aprovação"
          description="Enquanto o administrador ou o gestor não aprovar o cadastro, faça um orçamento. Depois da aprovação, é só transformar o orçamento em pedido."
          action={<Button onClick={() => nav(`/vendedor/novo-orcamento?cliente=${c.id}`)}>Fazer orçamento</Button>}
        />
      </Card>
    );
  }

  // ---------- itens ----------
  const addProduct = (p: CatalogProduct, qty: number, saleUnit: SaleUnit) => {
    if (!Number.isInteger(qty) || qty <= 0) return toast.error('Informe uma quantidade maior que zero.');
    const line: Line = {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      brandName: p.brand.name,
      baseUnit: p.unit,
      unitsPerBox: p.unitsPerBox,
      boxOnly: !!p.boxOnly,
      saleUnit,
      imageFileName: p.imageFileName,
      basePriceCents: p.priceCents,
      quantity: qty,
      discountBps: 0,
    };
    const exists = s.items.find((i) => sameLine(i, line));
    update({
      items: exists
        ? s.items.map((i) => (sameLine(i, line) ? { ...i, quantity: i.quantity + qty, basePriceCents: p.priceCents } : i))
        : [...s.items, line],
    });
    toast.success(exists ? `${p.name}: agora ${exists.quantity + qty} ${unitLabel(line)}` : `${qty} ${unitLabel(line)} • ${p.name}`, { duration: 1400 });
  };
  const patchLine = (l: Line, patch: Partial<Line>) => {
    const next = { ...l, ...patch };
    // trocar UN↔CX para uma unidade que já está no carrinho junta as linhas
    const dup = patch.saleUnit && s.items.find((i) => i !== l && sameLine(i, next));
    update({
      items: dup
        ? s.items.filter((i) => i !== l).map((i) => (i === dup ? { ...i, quantity: i.quantity + next.quantity } : i))
        : s.items.map((i) => (i === l ? next : i)),
    });
  };
  const remove = async (l: Line) => {
    if (await confirm({ title: 'Remover produto?', message: `Remover “${l.name}” (${unitLabel(l)}) do ${docLabel}?`, tone: 'danger', confirmLabel: 'Remover' })) {
      update({ items: s.items.filter((i) => i !== l) });
    }
  };

  // ---------- persistência ----------
  const payload = (extra: Record<string, unknown>) => ({
    idempotencyKey: s.key,
    clientId: s.clientId,
    items: s.items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountBps: i.discountBps, saleUnit: i.saleUnit })),
    generalDiscountBps: s.generalDiscountBps,
    freightCents: s.freightCents,
    paymentTermId: s.paymentTermId || null,
    notes: s.notes || null,
    expectedDelivery: s.expectedDelivery || null,
    discountReason: s.discountReason || null,
    ...extra,
  });

  const handleError = (e: unknown, retry: () => void) => {
    if (e instanceof ApiError && e.code === 'DISCOUNT_LIMIT') {
      update({ step: 1 });
      toast.error(e.message);
      return;
    }
    if (e instanceof ApiError && (e.code === 'PRODUCT_INACTIVE' || e.code === 'NO_BOX_UNIT' || e.code === 'INSUFFICIENT_STOCK')) {
      toast.error(e.message);
      update({ step: 1 });
      return;
    }
    toast.error(errorMessage(e), e instanceof ApiError && (e.status === 0 || e.status >= 500) ? { action: { label: 'Tentar novamente', onClick: retry }, duration: 10000 } : undefined);
  };

  const finish = (path: string) => {
    clearSession(storeKey);
    void qc.invalidateQueries();
    nav(path, { replace: true });
  };

  const generatePdf = async (kind: 'orders' | 'quotes', id: string) => {
    try {
      await api(`/documents/${kind}/${id}`, { method: 'POST', body: {} });
      toast.success('PDF gerado. Use Visualizar, Baixar, Compartilhar ou WhatsApp.');
    } catch (e) {
      toast.error(`${errorMessage(e)} O ${docLabel} foi salvo; gere o PDF novamente na próxima tela.`);
    }
  };

  /** Sem internet: guarda no aparelho (mesma chave de idempotência) e envia ao sincronizar. */
  const saveOffline = async (path: string, method: 'POST' | 'PUT', body: Record<string, unknown>, action: string) => {
    await queueDoc({
      id: s.key,
      kind: isQuote ? 'quote' : 'order',
      method,
      path,
      body,
      action,
      label: c?.tradeName ?? c?.legalName ?? 'Cliente',
      totalCents: calc.result?.totalCents ?? 0,
      wizard: { mode, state: s },
    });
    const what = isQuote ? 'Orçamento salvo' : action === 'DRAFT' ? 'Rascunho salvo' : 'Pedido salvo';
    toast.success(`${what} no celular. Será enviado sozinho quando a internet voltar.`, { duration: 6000 });
    clearSession(storeKey);
    nav('/vendedor/sincronizar', { replace: true });
  };
  const offlineFailure = (e: unknown) => e instanceof ApiError && e.status === 0;

  const saveOrder = async (action: 'DRAFT' | 'CONFIRM' | 'REQUEST_APPROVAL', thenPdf = false): Promise<void> => {
    setBusy(action + (thenPdf ? '-pdf' : ''));
    const body = payload({ action });
    const path = s.savedId ? `/seller/orders/${s.savedId}` : '/seller/orders';
    const method = s.savedId ? 'PUT' : 'POST';
    try {
      if (workingOffline()) return await saveOffline(path, method, body, action);
      const res = await api(path, { method, body });
      void removeOutbox(s.key);
      const order = res.order;
      update({ savedId: order.id });
      if (res.duplicate) toast.info('Este pedido já havia sido registrado — nenhum pedido duplicado foi criado.');
      if (action === 'DRAFT') {
        toast.success('Rascunho salvo.');
        if (thenPdf) {
          await generatePdf('orders', order.id);
          finish(`/vendedor/pedidos/${order.id}`);
        }
        return;
      }
      toast.success(action === 'CONFIRM' ? `Pedido ${order.number} confirmado!` : `Pedido ${order.number} enviado para aprovação do administrador.`);
      finish(`/vendedor/pedidos/${order.id}?novo=1`);
    } catch (e) {
      if (offlineFailure(e)) return await saveOffline(path, method, body, action).catch((err) => handleError(err, () => void saveOrder(action, thenPdf)));
      handleError(e, () => void saveOrder(action, thenPdf));
    } finally {
      setBusy(null);
    }
  };

  const saveQuote = async (requestApproval: boolean, thenPdf = false): Promise<void> => {
    setBusy(thenPdf ? 'QUOTE-pdf' : 'QUOTE');
    const body = payload({ validUntil: s.validUntil || null, requestApproval });
    const path = s.savedId ? `/seller/quotes/${s.savedId}` : '/seller/quotes';
    const method = s.savedId ? 'PUT' : 'POST';
    const action = requestApproval && overLimit ? 'REQUEST_APPROVAL' : 'SAVE';
    try {
      if (workingOffline()) return await saveOffline(path, method, body, action);
      const res = await api(path, { method, body });
      void removeOutbox(s.key);
      const quote = res.quote;
      update({ savedId: quote.id });
      toast.success(requestApproval && overLimit ? `Orçamento ${quote.number} salvo e enviado para aprovação do desconto.` : `Orçamento ${quote.number} salvo.`);
      if (thenPdf) await generatePdf('quotes', quote.id);
      finish(`/vendedor/orcamentos/${quote.id}?novo=1`);
    } catch (e) {
      if (offlineFailure(e)) return await saveOffline(path, method, body, action).catch((err) => handleError(err, () => void saveQuote(requestApproval, thenPdf)));
      handleError(e, () => void saveQuote(requestApproval, thenPdf));
    } finally {
      setBusy(null);
    }
  };

  const confirmOrder = async () => {
    const ok = await confirm({
      title: 'Confirmar pedido?',
      message: (
        <div className="space-y-2">
          <p>
            Pedido para <strong>{c?.tradeName ?? c?.legalName}</strong> no valor de <strong>{formatBRL(calc.result?.totalCents ?? 0)}</strong>.
          </p>
          <p className="text-muted">Depois de confirmado, o pedido recebe um número definitivo e não pode mais ser editado.</p>
        </div>
      ),
      confirmLabel: 'Confirmar pedido',
      tone: 'success',
    });
    if (ok) await saveOrder('CONFIRM');
  };

  const go = (step: number) => {
    update({ step });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const canNext = s.items.length > 0 && !calc.error && (s.step !== 1 || !overLimit || !!s.discountReason.trim());

  const cancelAll = async () => {
    if (await confirm({ title: `Sair do ${docLabel}?`, message: s.savedId ? 'Alterações não salvas serão perdidas. O que já foi salvo continua disponível.' : 'Os produtos escolhidos serão descartados.', tone: 'danger', confirmLabel: 'Sair', cancelLabel: 'Continuar aqui' })) {
      clearSession(storeKey);
      nav('/vendedor');
    }
  };

  return (
    <div className="pb-40 lg:pb-28">
      {/* Cabeçalho compacto */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-600">
            {editId ? `Editar ${docLabel} ${existing.data?.number ?? ''}` : isQuote ? 'Novo orçamento' : 'Novo pedido'}
          </p>
          <h1 className="truncate text-lg font-semibold text-navy-900 sm:text-xl">{c ? c.tradeName ?? c.legalName : 'Carregando cliente…'}</h1>
          {c && <p className="text-xs text-muted">CNPJ {formatCnpj(c.cnpj)}</p>}
        </div>
        <Button variant="ghost" size="sm" icon={<X className="size-4" />} onClick={cancelAll}>
          Sair
        </Button>
      </div>
      <StepBar current={s.step} onStep={(i) => i < s.step && go(i)} />

      {s.step === 0 && <StepProducts s={s} cfg={cfg} onAdd={addProduct} onPatch={patchLine} onRemove={remove} />}
      {s.step === 1 && <StepReview s={s} cfg={cfg} calc={calc.result} check={check} update={update} onPatch={patchLine} onRemove={remove} isQuote={isQuote} onAddMore={() => go(0)} />}
      {s.step === 2 && (
        <StepConfirm s={s} cfg={cfg} calc={calc.result} client={c} sellerName={me?.rep?.fullName ?? ''} isQuote={isQuote} overLimit={overLimit} reasons={check?.reasons ?? []}>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            {isQuote ? (
              <>
                {!overLimit && (
                  <Button variant="gold" size="lg" className="sm:order-last" icon={<FileText className="size-5" />} loading={busy === 'QUOTE-pdf'} disabled={!!busy} onClick={() => saveQuote(false, true)}>
                    Salvar e gerar PDF
                  </Button>
                )}
                <Button variant={overLimit ? 'gold' : 'secondary'} size="lg" icon={overLimit ? <Send className="size-5" /> : <Save className="size-5" />} loading={busy === 'QUOTE'} disabled={!!busy} onClick={() => saveQuote(overLimit)}>
                  {overLimit ? 'Salvar e pedir aprovação do desconto' : 'Salvar orçamento'}
                </Button>
              </>
            ) : (
              <>
                {overLimit ? (
                  <Button variant="gold" size="lg" className="sm:order-last" icon={<Send className="size-5" />} loading={busy === 'REQUEST_APPROVAL'} disabled={!!busy} onClick={() => saveOrder('REQUEST_APPROVAL')}>
                    Enviar para aprovação
                  </Button>
                ) : (
                  <Button variant="success" size="lg" className="sm:order-last" icon={<CheckCircle2 className="size-5" />} loading={busy === 'CONFIRM'} disabled={!!busy} onClick={confirmOrder}>
                    Confirmar pedido
                  </Button>
                )}
                <Button variant="secondary" size="lg" icon={<Save className="size-5" />} loading={busy === 'DRAFT'} disabled={!!busy} onClick={() => saveOrder('DRAFT')}>
                  Salvar rascunho
                </Button>
                <Button variant="secondary" size="lg" icon={<FileText className="size-5" />} loading={busy === 'DRAFT-pdf'} disabled={!!busy} onClick={() => saveOrder('DRAFT', true)}>
                  PDF do rascunho
                </Button>
              </>
            )}
          </div>
        </StepConfirm>
      )}

      {/* Barra inferior fixa: total + navegação */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_rgba(15,35,65,0.10)] backdrop-blur lg:left-64">
        {calc.error && <p className="px-4 pt-2 text-xs text-red-600 lg:px-8">{calc.error}</p>}
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 lg:px-8">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => s.items.length && setCartOpen(true)} aria-label="Ver itens do pedido">
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-800">
              <ShoppingCart className="size-5" />
              {s.items.length > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-gold-500 px-1.5 text-[11px] font-semibold text-white">{s.items.length}</span>}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs text-muted">
                {s.items.length ? `${s.items.length} produto(s)` : 'Nenhum produto'}
                {!!calc.result?.totalDiscountCents && <span className="hidden text-red-600 sm:inline"> • −{formatBRL(calc.result.totalDiscountCents)}</span>}
              </span>
              <span className="flex items-center gap-1 whitespace-nowrap text-lg font-semibold tabular text-navy-900">
                {formatBRL(calc.result?.totalCents ?? 0)}
                {s.items.length > 0 && <ChevronUp className="size-4 text-muted lg:hidden" />}
              </span>
              {overLimit && <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700"><ShieldAlert className="size-3.5" /> Desconto acima do limite</span>}
            </span>
          </button>
          {s.step > 0 && (
            <Button variant="secondary" size="lg" className="px-3 sm:px-5" onClick={() => go(s.step - 1)} aria-label="Voltar">
              <ArrowLeft className="size-5" />
              <span className="hidden sm:inline">Voltar</span>
            </Button>
          )}
          {s.step < 2 && (
            <Button size="lg" disabled={!canNext} onClick={() => go(s.step + 1)}>
              {s.step === 0 ? 'Revisar' : 'Continuar'} <ArrowRight className="size-5" />
            </Button>
          )}
        </div>
      </div>

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title={`Itens do ${docLabel}`} size="lg" footer={<Button onClick={() => setCartOpen(false)}>Fechar</Button>}>
        <CartList items={s.items} calc={calc.result} onPatch={patchLine} onRemove={remove} />
      </Modal>
    </div>
  );
}

// ======================================================================== Navegação das etapas
function StepBar({ current, onStep }: { current: number; onStep: (i: number) => void }) {
  return (
    <ol className="mb-5 grid grid-cols-3 gap-2" aria-label="Etapas">
      {STEPS.map((label, i) => (
        <li key={label}>
          <button type="button" onClick={() => onStep(i)} disabled={i >= current} className="w-full text-left disabled:cursor-default" aria-current={i === current ? 'step' : undefined}>
            <span className={cx('block h-1.5 rounded-full', i < current ? 'bg-gold-500' : i === current ? 'bg-navy-900' : 'bg-slate-200')} />
            <span className={cx('mt-1.5 block truncate text-xs', i === current ? 'font-semibold text-navy-900' : 'text-muted')}>
              {i + 1}. {label}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Stepper({ value, onChange, size = 'md' }: { value: number; onChange: (v: number) => void; size?: 'md' | 'lg' }) {
  const btn = size === 'lg' ? 'size-11' : 'size-10';
  return (
    <div className="flex items-center rounded-xl border border-line bg-white">
      <button type="button" className={cx(btn, 'flex items-center justify-center text-navy-800 active:bg-navy-50 disabled:opacity-30')} disabled={value <= 1} onClick={() => onChange(value - 1)} aria-label="Diminuir">
        <Minus className="size-4" />
      </button>
      <input
        className="w-12 bg-transparent text-center text-base font-semibold tabular outline-none"
        inputMode="numeric"
        value={value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(Math.min(1_000_000, Math.max(1, parseInt(e.target.value.replace(/\D/g, '') || '1', 10))))}
        aria-label="Quantidade"
      />
      <button type="button" className={cx(btn, 'flex items-center justify-center text-navy-800 active:bg-navy-50')} onClick={() => onChange(value + 1)} aria-label="Aumentar">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

function UnitToggle({ value, onChange, baseUnit, unitsPerBox }: { value: SaleUnit; onChange: (u: SaleUnit) => void; baseUnit: string; unitsPerBox: number | null }) {
  if (!unitsPerBox) return <span className="inline-flex h-10 items-center rounded-xl bg-slate-100 px-3 text-sm font-medium text-muted">{baseUnit}</span>;
  const opt = (u: SaleUnit, label: ReactNode) => (
    <button
      type="button"
      onClick={() => onChange(u)}
      aria-pressed={value === u}
      className={cx('h-10 rounded-lg px-3 text-sm font-semibold transition', value === u ? 'bg-navy-900 text-white shadow' : 'text-navy-800')}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-0.5" role="group" aria-label="Unidade de venda">
      {opt('UN', baseUnit)}
      {opt('CX', `CX ${unitsPerBox}`)}
    </div>
  );
}

// ======================================================================== Etapa 1: produtos
function StepProducts({ s, cfg, onAdd, onPatch, onRemove }: { s: WizardState; cfg: SellerConfig; onAdd: (p: CatalogProduct, q: number, u: SaleUnit) => void; onPatch: (l: Line, p: Partial<Line>) => void; onRemove: (l: Line) => void }) {
  const [q, setQ] = useState('');
  const [brandId, setBrand] = useState('');
  const [categoryId, setCat] = useState('');
  const [onlyAvailable, setAvail] = useState(false);
  const dq = useDebounced(q, 250);
  const searchRef = useRef<HTMLInputElement>(null);
  const brands = useQuery({ queryKey: ['seller-brands'], queryFn: () => api<{ id: string; name: string }[]>('/seller/brands') });
  const cats = useQuery({ queryKey: ['seller-cats'], queryFn: () => api<{ id: string; name: string }[]>('/seller/categories') });
  const cat = useQuery({
    queryKey: ['seller-catalog', dq, brandId, categoryId, onlyAvailable],
    queryFn: () => api<{ brands: { id: string; name: string; products: CatalogProduct[] }[]; total: number }>('/seller/catalog', { query: { q: dq, brandId, categoryId, onlyAvailable: onlyAvailable ? 'true' : '' } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <div className="sticky top-14 z-10 -mx-4 mb-4 border-b border-line bg-canvas/95 px-4 pb-3 pt-2 backdrop-blur lg:-mx-1 lg:px-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
            <Input ref={searchRef} type="search" enterKeyHint="search" className="h-12 rounded-xl pl-11 text-base" placeholder="Buscar produto por nome ou código" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0">
            <button onClick={() => setBrand('')} className={cx('h-9 shrink-0 rounded-full border px-4 text-sm', !brandId ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white')}>
              Todas
            </button>
            {brands.data?.map((b) => (
              <button key={b.id} onClick={() => setBrand(brandId === b.id ? '' : b.id)} className={cx('h-9 shrink-0 rounded-full border px-4 text-sm', brandId === b.id ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white')}>
                {b.name}
              </button>
            ))}
          </div>
          {(!!cats.data?.length || cfg.stockEnabled) && (
            <div className="mt-2 flex items-center gap-3">
              {!!cats.data?.length && (
                <Select className="h-10 max-w-60" value={categoryId} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
                  <option value="">Todas as categorias</option>
                  {cats.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              )}
              {cfg.stockEnabled && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" className="size-4 accent-navy-800" checked={onlyAvailable} onChange={(e) => setAvail(e.target.checked)} /> Só disponíveis
                </label>
              )}
            </div>
          )}
        </div>
        {cat.isLoading ? (
          <Loading label="Carregando catálogo…" />
        ) : cat.data?.brands.length === 0 ? (
          <Card><EmptyState icon={<PackageSearch className="size-6" />} title="Nenhum produto encontrado" description="Tente outro nome ou código, ou limpe os filtros." /></Card>
        ) : (
          <div className={cx('space-y-7', cat.isFetching && 'opacity-70')}>
            {cat.data?.brands.map((b) => (
              <section key={b.id}>
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-base font-semibold text-navy-900">{b.name}</h3>
                  <span className="h-px flex-1 bg-gradient-to-r from-gold-300 to-transparent" />
                  <span className="text-xs text-muted">{b.products.length}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {b.products.map((p) => (
                    <ProductCard key={p.id} p={p} lines={s.items.filter((i) => i.productId === p.id)} onAdd={onAdd} stockEnabled={cfg.stockEnabled} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <aside className="hidden xl:sticky xl:top-20 xl:block xl:h-fit">
        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-navy-900"><ShoppingCart className="size-4 text-gold-500" /> Itens escolhidos</h3>
            <span className="rounded-full bg-navy-900 px-2 py-0.5 text-xs font-semibold text-white">{s.items.length}</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-4 py-2">
            <CartList items={s.items} calc={null} onPatch={onPatch} onRemove={onRemove} compact />
          </div>
        </Card>
      </aside>
    </div>
  );
}

/** Saldo disponível para o vendedor: em caixas quando o produto é vendido só por caixa. */
function stockInfo(p: CatalogProduct, stockEnabled: boolean) {
  if (!stockEnabled || p.availableQty === null) return null;
  const box = p.boxOnly && p.unitsPerBox && p.unitsPerBox > 1 ? p.unitsPerBox : null;
  const avail = box ? Math.floor(p.availableQty / box) : p.availableQty;
  const label = box ? `${avail} ${avail === 1 ? 'caixa disponível' : 'caixas disponíveis'}` : `${avail} ${p.unit} disponíveis`;
  return { avail, label, box };
}

function ProductCard({ p, lines, onAdd, stockEnabled }: { p: CatalogProduct; lines: Line[]; onAdd: (p: CatalogProduct, q: number, u: SaleUnit) => void; stockEnabled: boolean }) {
  const [qty, setQty] = useState(1);
  const boxOnly = !!p.boxOnly && !!p.unitsPerBox && p.unitsPerBox > 1;
  const [unit, setUnit] = useState<SaleUnit>(boxOnly ? 'CX' : 'UN');
  const st = stockInfo(p, stockEnabled);
  // quanto ainda dá para adicionar (descontando o que já está no carrinho), na unidade escolhida
  const inCartBase = lines.reduce((a, l) => a + l.quantity * (l.saleUnit === 'CX' && l.unitsPerBox ? l.unitsPerBox : 1), 0);
  const factor = unit === 'CX' && p.unitsPerBox ? p.unitsPerBox : 1;
  const maxAdd = st ? Math.max(0, Math.floor(((p.availableQty ?? 0) - inCartBase) / factor)) : Infinity;
  const unavailable = !!st && maxAdd <= 0;
  const price = p.priceCents * factor;
  return (
    <div className={cx('rounded-2xl border bg-white p-3.5 shadow-[0_1px_2px_rgba(15,35,65,0.04)]', lines.length ? 'border-gold-300 ring-1 ring-gold-200' : 'border-line', unavailable && !lines.length && 'opacity-70')}>
      <div className="flex gap-3">
        <ProductThumb fileName={p.imageFileName} alt={p.name} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] font-medium leading-snug text-navy-900">{p.name}</p>
          <p className="text-xs text-muted">{p.sku}</p>
          <p className="mt-1 text-lg font-semibold tabular text-navy-900">
            {formatBRL(price)}
            <span className="text-xs font-normal text-muted"> / {unit === 'CX' ? `caixa (${p.unitsPerBox} ${p.unit})` : p.unit}</span>
          </p>
          {st && <p className={cx('text-xs font-medium', st.avail <= 0 ? 'text-red-600' : 'text-emerald-700')}>{st.avail <= 0 ? 'Sem estoque' : st.label}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {boxOnly ? (
          <span className="inline-flex h-10 items-center rounded-xl bg-slate-100 px-3 text-sm font-semibold text-navy-800">CX {p.unitsPerBox}</span>
        ) : (
          <UnitToggle value={unit} onChange={(u) => { setUnit(u); setQty(1); }} baseUnit={p.unit} unitsPerBox={p.unitsPerBox} />
        )}
        <Stepper value={Math.min(qty, Number.isFinite(maxAdd) ? Math.max(1, maxAdd) : qty)} onChange={(v) => setQty(Number.isFinite(maxAdd) ? Math.min(v, Math.max(1, maxAdd)) : v)} />
        <Button
          className="h-10 min-w-28 flex-1"
          icon={<Plus className="size-4" />}
          disabled={unavailable}
          onClick={() => {
            const q = Number.isFinite(maxAdd) ? Math.min(qty, maxAdd) : qty;
            if (q <= 0) return;
            onAdd(p, q, unit);
            setQty(1);
          }}
          aria-label={`Adicionar ${p.name}`}
        >
          {unavailable ? (lines.length ? 'Tudo no carrinho' : 'Sem estoque') : 'Adicionar'}
        </Button>
      </div>
      {lines.length > 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs font-medium text-gold-700">
          <CheckCircle2 className="size-3.5" /> No carrinho: {lines.map((l) => `${l.quantity} ${unitLabel(l)}`).join(' + ')}
        </p>
      )}
    </div>
  );
}

function CartList({ items, calc, onPatch, onRemove, compact, allowItemDiscount }: { items: Line[]; calc: CalcResult | null; onPatch: (l: Line, p: Partial<Line>) => void; onRemove: (l: Line) => void; compact?: boolean; allowItemDiscount?: boolean }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">Nenhum produto ainda. Toque em “Adicionar” nos produtos.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((l, idx) => {
        const line = calc?.lines[idx];
        return (
          <li key={`${l.productId}:${l.saleUnit}`} className="py-3">
            <div className="flex gap-3">
              {!compact && <ProductThumb fileName={l.imageFileName} alt={l.name} size="sm" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug text-navy-900">{l.name}</p>
                    <p className="text-xs text-muted">
                      {l.sku} • {formatBRL(linePrice(l))}/{unitLabel(l)}
                      {l.saleUnit === 'CX' && ` (${l.unitsPerBox} ${l.baseUnit})`}
                    </p>
                  </div>
                  <button type="button" className="-mr-1 rounded-lg p-2 text-muted hover:text-red-600" onClick={() => onRemove(l)} aria-label={`Remover ${l.name}`}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {l.boxOnly ? (
                    <span className="inline-flex h-10 items-center rounded-xl bg-slate-100 px-3 text-sm font-semibold text-navy-800">CX {l.unitsPerBox}</span>
                  ) : (
                    <UnitToggle value={l.saleUnit} onChange={(u) => onPatch(l, { saleUnit: u })} baseUnit={l.baseUnit} unitsPerBox={l.unitsPerBox} />
                  )}
                  <Stepper value={l.quantity} onChange={(v) => onPatch(l, { quantity: v })} />
                  {allowItemDiscount && (
                    <div className="w-24">
                      <PercentInput value={l.discountBps} onChange={(v) => onPatch(l, { discountBps: v ?? 0 })} aria-label={`Desconto do item ${l.name}`} placeholder="Desc." />
                    </div>
                  )}
                  <span className="ml-auto text-base font-semibold tabular text-navy-900">{formatBRL(line ? line.netBeforeGeneralCents : linePrice(l) * l.quantity)}</span>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ======================================================================== Etapa 2: revisão, desconto e condições
function StepReview({ s, cfg, calc, check, update, onPatch, onRemove, isQuote, onAddMore }: { s: WizardState; cfg: SellerConfig; calc: CalcResult | null; check: { withinLimit: boolean; reasons: string[] } | null; update: (p: Partial<WizardState>) => void; onPatch: (l: Line, p: Partial<Line>) => void; onRemove: (l: Line) => void; isQuote: boolean; onAddMore: () => void }) {
  const over = !!check && !check.withinLimit;
  const maxPct = Math.floor(cfg.maxDiscountBps / 100);
  const chips = Array.from({ length: maxPct + 1 }, (_, i) => i * 100);
  const isChip = chips.includes(s.generalDiscountBps);
  const [custom, setCustom] = useState(!isChip);
  if (!s.items.length) return <Card><EmptyState title="Nenhum produto adicionado" action={<Button onClick={onAddMore}>Adicionar produtos</Button>} /></Card>;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <Card>
          <CardTitle actions={<Button variant="secondary" size="sm" icon={<Plus className="size-4" />} onClick={onAddMore}>Mais produtos</Button>}>Itens</CardTitle>
          <CartList items={s.items} calc={calc} onPatch={onPatch} onRemove={onRemove} allowItemDiscount={cfg.allowItemDiscount} />
        </Card>

        <Card>
          <CardTitle icon={<BadgePercent className="size-4" />}>Desconto do vendedor</CardTitle>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Desconto do vendedor">
            {chips.map((bps) => (
              <button
                key={bps}
                type="button"
                onClick={() => {
                  setCustom(false);
                  update({ generalDiscountBps: bps });
                }}
                aria-pressed={!custom && s.generalDiscountBps === bps}
                className={cx(
                  'h-11 min-w-14 rounded-xl border px-4 text-base font-semibold transition',
                  !custom && s.generalDiscountBps === bps ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white text-navy-900 active:bg-navy-50',
                )}
              >
                {bps === 0 ? 'Sem' : `${bps / 100}%`}
              </button>
            ))}
            <button type="button" onClick={() => setCustom(true)} aria-pressed={custom} className={cx('h-11 rounded-xl border px-4 text-sm font-medium', custom ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white text-navy-900')}>
              Outro
            </button>
          </div>
          {custom && (
            <div className="mt-3 max-w-48">
              <Field label="Desconto do vendedor (%)">
                <PercentInput value={s.generalDiscountBps} invalid={over} onChange={(v) => update({ generalDiscountBps: v ?? 0 })} aria-label="Desconto do vendedor em percentual" />
              </Field>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Seu limite: {formatBps(cfg.maxDiscountBps)}. Os valores são recalculados na hora.</p>
          {calc && calc.generalDiscountCents > 0 && (
            <p className="mt-2 text-sm">
              Desconto de <strong className="text-red-600">−{formatBRL(calc.generalDiscountCents)}</strong> sobre {formatBRL(calc.subtotalAfterItemDiscountCents)}
            </p>
          )}
          {over && (
            <div className="mt-4 space-y-3">
              <Alert tone="amber" title="Acima do seu limite">
                <ul className="list-disc pl-4">{check!.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <p className="mt-1">Reduza o desconto ou explique o motivo para o administrador aprovar.</p>
              </Alert>
              <Field label="Motivo do desconto (para o administrador)" required>
                <Textarea rows={3} value={s.discountReason} onChange={(e) => update({ discountReason: e.target.value })} placeholder="Ex.: cliente novo com volume alto…" />
              </Field>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Condições</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Condição de pagamento">
              <Select value={s.paymentTermId} onChange={(e) => update({ paymentTermId: e.target.value })}>
                <option value="">A combinar</option>
                {cfg.paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Previsão de entrega" hint="Opcional">
              <Input type="date" min={cfg.today} value={s.expectedDelivery} onChange={(e) => update({ expectedDelivery: e.target.value })} />
            </Field>
            {isQuote && (
              <Field label="Validade da proposta" required>
                <Input type="date" min={cfg.today} value={s.validUntil} onChange={(e) => update({ validUntil: e.target.value })} />
              </Field>
            )}
            {cfg.allowSellerFreight && (
              <Field label="Frete" hint="Se houver">
                <MoneyInput value={s.freightCents} onChange={(v) => update({ freightCents: v ?? 0 })} />
              </Field>
            )}
            <Field label="Observações" className="sm:col-span-2" hint="Aparecem no PDF do cliente.">
              <Textarea rows={3} value={s.notes} onChange={(e) => update({ notes: e.target.value })} />
            </Field>
          </div>
        </Card>
      </div>
      <div className="lg:sticky lg:top-20 lg:h-fit">
        <SummaryCard calc={calc} />
      </div>
    </div>
  );
}

function SummaryCard({ calc }: { calc: CalcResult | null }) {
  if (!calc) return <Card><EmptyState title="Adicione produtos para ver os valores" /></Card>;
  const rows: [string, string, string?][] = [
    ['Quantidade', `${calc.itemCount} produto${calc.itemCount === 1 ? '' : 's'}`],
    ['Subtotal', formatBRL(calc.grossCents)],
    ...(calc.itemDiscountCents ? ([['Desconto nos itens', `−${formatBRL(calc.itemDiscountCents)}`, 'text-red-600']] as [string, string, string][]) : []),
    ...(calc.generalDiscountCents ? ([[`Desconto (${formatBps(calc.generalDiscountBps)})`, `−${formatBRL(calc.generalDiscountCents)}`, 'text-red-600']] as [string, string, string][]) : []),
    ...calc.surcharges.map((x) => [`${x.name} (${formatBps(x.rateBps)})`, `+${formatBRL(x.amountCents)}`] as [string, string]),
    ...(calc.freightCents ? ([['Frete', `+${formatBRL(calc.freightCents)}`]] as [string, string][]) : []),
  ];
  return (
    <Card>
      <CardTitle>Resumo</CardTitle>
      <dl className="space-y-2.5 text-sm">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className={cx('tabular', cls)}>{v}</dd></div>
        ))}
      </dl>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-navy-900 px-5 py-4 text-white">
        <span className="font-medium">Valor final</span>
        <span className="text-2xl font-semibold tabular">{formatBRL(calc.totalCents)}</span>
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer py-1 text-navy-700">Como os valores foram calculados</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">{calc.steps.map((st) => <li key={st}>{st}</li>)}</ol>
      </details>
    </Card>
  );
}

// ======================================================================== Etapa 3: confirmação
function StepConfirm({ s, cfg, calc, client, sellerName, isQuote, overLimit, reasons, children }: { s: WizardState; cfg: SellerConfig; calc: CalcResult | null; client: any; sellerName: string; isQuote: boolean; overLimit: boolean; reasons: string[]; children: ReactNode }) {
  // validação dos valores pelo servidor (preços atuais do banco)
  const preview = useQuery({
    queryKey: ['preview', s.items, s.generalDiscountBps, s.freightCents],
    queryFn: () =>
      api<{ calc: CalcResult; offline?: boolean; pricesFrom?: string }>('/seller/pricing/preview', {
        body: { items: s.items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountBps: i.discountBps, saleUnit: i.saleUnit })), generalDiscountBps: s.generalDiscountBps, freightCents: s.freightCents },
      }),
    retry: false,
  });
  const server = preview.data?.calc;
  const differs = server && calc && server.totalCents !== calc.totalCents;
  const term = cfg.paymentTerms.find((t) => t.id === s.paymentTermId);
  const shown = server ?? calc;
  return (
    <div className="space-y-5">
      {preview.isError && <Alert tone="red" title="Não foi possível validar os valores">{errorMessage(preview.error)}</Alert>}
      {differs && <Alert tone="amber" title="Preços atualizados">Alguns preços do catálogo mudaram. Os valores abaixo já usam os preços atuais.</Alert>}
      {overLimit && <Alert tone="amber" title="Vai para aprovação do administrador">{reasons.join(' ')}</Alert>}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardTitle>{isQuote ? 'Resumo do orçamento' : 'Resumo do pedido'}</CardTitle>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="col-span-2"><dt className="text-xs uppercase tracking-wide text-muted">Cliente</dt><dd className="font-medium">{client?.legalName}</dd><dd className="text-xs text-muted">CNPJ {client && formatCnpj(client.cnpj)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Vendedor</dt><dd>{sellerName}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Data</dt><dd>{formatDateBR(cfg.today)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Pagamento</dt><dd>{term ? `${term.name}` : 'A combinar'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Entrega</dt><dd>{s.expectedDelivery ? formatDateBR(s.expectedDelivery) : '—'}</dd></div>
            {isQuote && <div><dt className="text-xs uppercase tracking-wide text-muted">Validade</dt><dd>{s.validUntil ? formatDateBR(s.validUntil) : '—'}</dd></div>}
            {s.notes && <div className="col-span-2"><dt className="text-xs uppercase tracking-wide text-muted">Observações</dt><dd className="whitespace-pre-wrap">{s.notes}</dd></div>}
          </dl>
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {s.items.map((i, idx) => (
              <li key={`${i.productId}:${i.saleUnit}`} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{i.name}</p>
                  <p className="text-xs text-muted">
                    {i.quantity} {unitLabel(i)}
                    {i.saleUnit === 'CX' && ` (${i.unitsPerBox} ${i.baseUnit} cada)`} × {formatBRL(shown?.lines[idx]?.unitPriceCents ?? linePrice(i))}
                    {i.discountBps ? ` • desc. ${formatBps(i.discountBps)}` : ''}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular">{formatBRL(shown?.lines[idx]?.netBeforeGeneralCents ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-3">
          <SummaryCard calc={shown ?? null} />
          {server && !preview.data?.offline && <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" /> Valores validados pelo servidor.</p>}
          {preview.data?.offline && (
            <p className="flex items-start gap-1 text-xs text-amber-800">
              <CloudOff className="mt-px size-3.5 shrink-0" /> Sem internet: valores com os preços de {formatDateTimeBR(preview.data.pricesFrom)}. </p>
          )}
        </div>
      </div>
      <Card>{children}</Card>
    </div>
  );
}
