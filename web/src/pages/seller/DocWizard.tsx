import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  CheckCircle2,
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
} from 'lucide-react';
import { addDays, calculate, checkDiscountLimit, formatBRL, formatBps, formatCnpj, formatDateBR, type CalcResult, type PricingRule } from '@della/shared';
import { ApiError, api, errorMessage, newKey } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { clearSession, useDebounced, useSessionState } from '../../lib/hooks';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Input, Loading, Modal, MoneyInput, PageHeader, PercentInput, Select, Stepper, Textarea, cx, useConfirm } from '../../components/ui';
import { ProductThumb } from '../../components/common';

type Mode = 'order' | 'quote';

interface Line {
  productId: string;
  sku: string;
  name: string;
  brandName: string;
  unit: string;
  imageFileName: string | null;
  unitPriceCents: number;
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
  description: string | null;
  priceCents: number;
  imageFileName: string | null;
  availableQty: number | null;
  brand: { id: string; name: string };
  category: { id: string; name: string } | null;
}

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

export default function DocWizard({ mode }: { mode: Mode }) {
  const { id: editId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { me } = useAuth();
  const clientParam = params.get('cliente') ?? '';
  const storeKey = `della:wizard:${mode}:${editId ?? clientParam}`;
  const [s, setS] = useSessionState<WizardState>(storeKey, blank(clientParam));
  const [busy, setBusy] = useState<null | string>(null);
  const [dupPrompt, setDupPrompt] = useState<{ product: CatalogProduct; qty: number } | null>(null);
  const isQuote = mode === 'quote';
  const docLabel = isQuote ? 'orçamento' : 'pedido';
  const steps = [isQuote ? 'Dados do orçamento' : 'Dados do pedido', 'Marcas e produtos', 'Revisão dos produtos', 'Resumo financeiro', 'Confirmação'];
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
        unit: i.unit,
        imageFileName: i.imageFileName,
        unitPriceCents: i.unitPriceCents,
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

  // cálculo instantâneo no navegador (mesmo motor do servidor; o servidor recalcula e valida ao salvar)
  const calc = useMemo<{ result: CalcResult | null; error: string | null }>(() => {
    if (!s.items.length) return { result: null, error: null };
    try {
      return {
        result: calculate({
          items: s.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPriceCents: i.unitPriceCents, discountBps: i.discountBps })),
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

  // ---------- itens ----------
  const addProduct = (p: CatalogProduct, qty: number, mode2: 'add' | 'sum' | 'replace' = 'add') => {
    if (!Number.isInteger(qty) || qty <= 0) return toast.error('Informe uma quantidade inteira maior que zero.');
    const exists = s.items.find((i) => i.productId === p.id);
    if (exists && mode2 === 'add') return setDupPrompt({ product: p, qty });
    if (exists) {
      update({ items: s.items.map((i) => (i.productId === p.id ? { ...i, quantity: mode2 === 'sum' ? i.quantity + qty : qty, unitPriceCents: p.priceCents } : i)) });
    } else {
      update({
        items: [...s.items, { productId: p.id, sku: p.sku, name: p.name, brandName: p.brand.name, unit: p.unit, imageFileName: p.imageFileName, unitPriceCents: p.priceCents, quantity: qty, discountBps: 0 }],
      });
    }
    toast.success(`${p.name} — ${exists && mode2 === 'sum' ? 'quantidade somada' : 'adicionado'}.`, { duration: 1500 });
  };
  const setQty = (pid: string, q: number) => update({ items: s.items.map((i) => (i.productId === pid ? { ...i, quantity: Math.max(1, Math.min(1_000_000, Math.floor(q) || 1)) } : i)) });
  const remove = async (pid: string) => {
    const it = s.items.find((i) => i.productId === pid);
    if (await confirm({ title: 'Remover produto?', message: `Remover “${it?.name}” do ${docLabel}?`, tone: 'danger', confirmLabel: 'Remover' })) {
      update({ items: s.items.filter((i) => i.productId !== pid) });
    }
  };

  // ---------- persistência ----------
  const payload = (extra: Record<string, unknown>) => ({
    idempotencyKey: s.key,
    clientId: s.clientId,
    items: s.items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountBps: i.discountBps })),
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
      update({ step: 3 });
      toast.error(e.message);
      return;
    }
    if (e instanceof ApiError && e.code === 'PRODUCT_INACTIVE') {
      toast.error(e.message);
      update({ step: 2 });
      return;
    }
    toast.error(errorMessage(e), e instanceof ApiError && (e.status === 0 || e.status >= 500) ? { action: { label: 'Tentar novamente', onClick: retry }, duration: 10000 } : undefined);
  };

  const finish = (path: string) => {
    clearSession(storeKey);
    void qc.invalidateQueries();
    nav(path, { replace: true });
  };

  const saveOrder = async (action: 'DRAFT' | 'CONFIRM' | 'REQUEST_APPROVAL', thenPdf = false): Promise<void> => {
    setBusy(action);
    try {
      const body = payload({ action });
      const res = s.savedId ? await api(`/seller/orders/${s.savedId}`, { method: 'PUT', body }) : await api('/seller/orders', { body });
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
      handleError(e, () => void saveOrder(action, thenPdf));
    } finally {
      setBusy(null);
    }
  };

  const saveQuote = async (requestApproval: boolean, thenPdf = false): Promise<void> => {
    setBusy(requestApproval ? 'REQUEST_APPROVAL' : 'DRAFT');
    try {
      const body = payload({ validUntil: s.validUntil || null, requestApproval });
      const res = s.savedId ? await api(`/seller/quotes/${s.savedId}`, { method: 'PUT', body }) : await api('/seller/quotes', { body });
      const quote = res.quote;
      update({ savedId: quote.id });
      toast.success(requestApproval && overLimit ? `Orçamento ${quote.number} salvo e enviado para aprovação do desconto.` : `Orçamento ${quote.number} salvo.`);
      if (thenPdf) await generatePdf('quotes', quote.id);
      finish(`/vendedor/orcamentos/${quote.id}?novo=1`);
    } catch (e) {
      handleError(e, () => void saveQuote(requestApproval, thenPdf));
    } finally {
      setBusy(null);
    }
  };

  const generatePdf = async (kind: 'orders' | 'quotes', id: string) => {
    try {
      await api(`/documents/${kind}/${id}`, { method: 'POST', body: {} });
      toast.success('PDF gerado. Use os botões Visualizar, Baixar ou Compartilhar.');
    } catch (e) {
      toast.error(`${errorMessage(e)} O ${docLabel} foi salvo; gere o PDF novamente na próxima tela.`);
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
          <p className="text-muted">Após a confirmação o pedido recebe um número definitivo e não poderá mais ser editado pelo vendedor.</p>
        </div>
      ),
      confirmLabel: 'Confirmar pedido',
      tone: 'success',
    });
    if (ok) await saveOrder('CONFIRM');
  };

  const canNext = s.step === 0 ? !!s.clientId : s.step === 1 || s.step === 2 ? s.items.length > 0 && !calc.error : true;
  const go = (step: number) => {
    update({ step });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelAll = async () => {
    if (await confirm({ title: `Descartar ${docLabel}?`, message: s.savedId ? 'As alterações não salvas serão perdidas. O rascunho salvo continuará disponível.' : 'Todos os dados preenchidos serão perdidos.', tone: 'danger', confirmLabel: 'Descartar' })) {
      clearSession(storeKey);
      nav('/vendedor');
    }
  };

  return (
    <div className="pb-36">
      <PageHeader
        title={editId ? `Editar ${docLabel} ${existing.data?.number ?? ''}` : isQuote ? 'Novo orçamento' : 'Novo pedido'}
        subtitle={c ? `${c.tradeName ?? c.legalName} • CNPJ ${formatCnpj(c.cnpj)}` : undefined}
        actions={<Button variant="ghost" onClick={cancelAll}>Cancelar</Button>}
      />
      <Card className="mb-6 py-4">
        <Stepper steps={steps} current={s.step} onStep={go} />
      </Card>

      {s.step === 0 && <StepData s={s} update={update} cfg={cfg} client={c} isQuote={isQuote} sellerName={me?.rep?.fullName ?? ''} existingNumber={existing.data?.number} />}
      {s.step === 1 && <StepProducts s={s} cfg={cfg} onAdd={addProduct} onQty={setQty} onRemove={remove} />}
      {s.step === 2 && <StepReview s={s} cfg={cfg} calc={calc.result} update={update} onQty={setQty} onRemove={remove} />}
      {s.step === 3 && <StepFinance s={s} cfg={cfg} calc={calc.result} check={check} update={update} />}
      {s.step === 4 && (
        <StepConfirm s={s} cfg={cfg} calc={calc.result} client={c} sellerName={me?.rep?.fullName ?? ''} isQuote={isQuote} overLimit={overLimit} reasons={check?.reasons ?? []}>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={() => go(3)}>Voltar e editar</Button>
            {isQuote ? (
              <>
                <Button variant="secondary" icon={<Save className="size-4" />} loading={busy === 'DRAFT'} disabled={!!busy || (overLimit && !s.discountReason)} onClick={() => saveQuote(overLimit)}>
                  {overLimit ? 'Salvar e solicitar aprovação' : 'Salvar orçamento'}
                </Button>
                {!overLimit && (
                  <Button variant="gold" icon={<FileText className="size-4" />} disabled={!!busy} onClick={() => saveQuote(false, true)}>
                    Salvar e gerar PDF
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="secondary" icon={<Save className="size-4" />} loading={busy === 'DRAFT'} disabled={!!busy} onClick={() => saveOrder('DRAFT')}>Salvar como rascunho</Button>
                <Button variant="secondary" icon={<FileText className="size-4" />} disabled={!!busy} onClick={() => saveOrder('DRAFT', true)}>Gerar PDF (rascunho)</Button>
                {overLimit ? (
                  <Button variant="gold" icon={<Send className="size-4" />} loading={busy === 'REQUEST_APPROVAL'} disabled={!!busy || !s.discountReason} onClick={() => saveOrder('REQUEST_APPROVAL')}>
                    Solicitar aprovação
                  </Button>
                ) : (
                  <Button variant="success" size="lg" icon={<CheckCircle2 className="size-5" />} loading={busy === 'CONFIRM'} disabled={!!busy} onClick={confirmOrder}>
                    Confirmar pedido
                  </Button>
                )}
              </>
            )}
          </div>
          {overLimit && !s.discountReason && <p className="mt-2 text-xs text-amber-700">Informe a justificativa do desconto na etapa “Resumo financeiro” para solicitar aprovação.</p>}
        </StepConfirm>
      )}

      {/* Resumo fixo dos valores */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 shadow-[0_-4px_20px_rgba(15,35,65,0.08)] backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-2 text-muted"><ShoppingCart className="size-4" /> {s.items.length} produto(s) • {calc.result?.totalQuantity ?? 0} un.</span>
            <span className="text-muted">Subtotal <strong className="tabular text-ink">{formatBRL(calc.result?.grossCents ?? 0)}</strong></span>
            {!!calc.result?.totalDiscountCents && <span className="text-muted">Descontos <strong className="tabular text-red-600">−{formatBRL(calc.result.totalDiscountCents)}</strong></span>}
            <span className="text-base text-navy-900">Total <strong className="tabular">{formatBRL(calc.result?.totalCents ?? 0)}</strong></span>
            {overLimit && <span className="flex items-center gap-1 text-xs font-medium text-amber-700"><ShieldAlert className="size-4" /> Desconto acima do limite</span>}
          </div>
          {s.step < 4 && (
            <div className="flex gap-2">
              {s.step > 0 && <Button variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={() => go(s.step - 1)}>Voltar</Button>}
              <Button disabled={!canNext} onClick={() => go(s.step + 1)}>
                Avançar <ArrowRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
        {calc.error && <p className="px-4 pb-2 text-xs text-red-600 lg:px-8">{calc.error}</p>}
      </div>

      <Modal
        open={!!dupPrompt}
        onClose={() => setDupPrompt(null)}
        title="Produto já adicionado"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDupPrompt(null)}>Cancelar</Button>
            <Button variant="secondary" onClick={() => { addProduct(dupPrompt!.product, dupPrompt!.qty, 'replace'); setDupPrompt(null); }}>Substituir por {dupPrompt?.qty}</Button>
            <Button onClick={() => { addProduct(dupPrompt!.product, dupPrompt!.qty, 'sum'); setDupPrompt(null); }}>Somar quantidade</Button>
          </>
        }
      >
        {dupPrompt && (
          <p className="text-sm">
            “{dupPrompt.product.name}” já está no {docLabel} com <strong>{s.items.find((i) => i.productId === dupPrompt.product.id)?.quantity}</strong> unidade(s). Deseja somar mais <strong>{dupPrompt.qty}</strong> à mesma linha?
          </p>
        )}
      </Modal>
    </div>
  );
}

// ======================================================================== Etapa 1
function StepData({ s, update, cfg, client, isQuote, sellerName, existingNumber }: { s: WizardState; update: (p: Partial<WizardState>) => void; cfg: SellerConfig; client: any; isQuote: boolean; sellerName: string; existingNumber?: string | null }) {
  const term = cfg.paymentTerms.find((t) => t.id === s.paymentTermId);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardTitle>{isQuote ? 'Dados do orçamento' : 'Dados do pedido'}</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isQuote ? 'Número do orçamento' : 'Número do pedido'}>
            <Input disabled value={existingNumber ?? (isQuote ? 'Gerado automaticamente ao salvar' : 'Gerado automaticamente na confirmação')} />
          </Field>
          <Field label="Data">
            <Input disabled value={formatDateBR(cfg.today)} />
          </Field>
          <Field label="Vendedor responsável">
            <Input disabled value={sellerName} />
          </Field>
          <Field label="Cliente">
            <Input disabled value={client ? `${client.tradeName ?? client.legalName} (${formatCnpj(client.cnpj)})` : 'Carregando…'} />
          </Field>
          <Field label="Condição de pagamento">
            <Select value={s.paymentTermId} onChange={(e) => update({ paymentTermId: e.target.value })}>
              <option value="">A combinar</option>
              {cfg.paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Prazo de pagamento">
            <Input disabled value={term ? (term.days ? `${term.days} dias` : 'À vista') : '—'} />
          </Field>
          <Field label="Previsão de entrega" hint="Opcional">
            <Input type="date" min={cfg.today} value={s.expectedDelivery} onChange={(e) => update({ expectedDelivery: e.target.value })} />
          </Field>
          {isQuote && (
            <Field label="Validade da proposta" required>
              <Input type="date" min={cfg.today} value={s.validUntil} onChange={(e) => update({ validUntil: e.target.value })} />
            </Field>
          )}
          <Field label={isQuote ? 'Observações do orçamento' : 'Observações do pedido'} className="sm:col-span-2" hint="Aparecem no PDF enviado ao cliente.">
            <Textarea rows={3} value={s.notes} onChange={(e) => update({ notes: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card>
        <CardTitle>Cliente</CardTitle>
        {client ? (
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-navy-900">{client.legalName}</p>
            {client.tradeName && <p className="text-muted">{client.tradeName}</p>}
            <p className="tabular">CNPJ {formatCnpj(client.cnpj)}</p>
            {client.responsibleName && <p>Responsável: {client.responsibleName}</p>}
            <p className="text-muted">{[client.address.city, client.address.state].filter(Boolean).join('/')}</p>
          </div>
        ) : (
          <Loading />
        )}
        <Alert tone="navy" icon={<BadgePercent className="size-4" />}>
          Seu desconto máximo permitido: <strong>{formatBps(cfg.maxDiscountBps)}</strong>
        </Alert>
      </Card>
    </div>
  );
}

// ======================================================================== Etapa 2
function StepProducts({ s, cfg, onAdd, onQty, onRemove }: { s: WizardState; cfg: SellerConfig; onAdd: (p: CatalogProduct, q: number) => void; onQty: (id: string, q: number) => void; onRemove: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [brandId, setBrand] = useState('');
  const [categoryId, setCat] = useState('');
  const [onlyAvailable, setAvail] = useState(false);
  const dq = useDebounced(q, 250);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => searchRef.current?.focus(), []);
  const brands = useQuery({ queryKey: ['seller-brands'], queryFn: () => api<{ id: string; name: string }[]>('/seller/brands') });
  const cats = useQuery({ queryKey: ['seller-cats'], queryFn: () => api<{ id: string; name: string }[]>('/seller/categories') });
  const cat = useQuery({
    queryKey: ['seller-catalog', dq, brandId, categoryId, onlyAvailable],
    queryFn: () => api<{ brands: { id: string; name: string; products: CatalogProduct[] }[]; total: number }>('/seller/catalog', { query: { q: dq, brandId, categoryId, onlyAvailable: onlyAvailable ? 'true' : '' } }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <div className="sticky top-14 z-10 -mx-1 mb-4 bg-canvas/95 px-1 pb-3 pt-1 backdrop-blur">
          <div className="grid gap-2 md:grid-cols-[1fr_180px_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input ref={searchRef} className="h-11 pl-9" placeholder="Pesquisar produto por nome ou código/SKU" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select className="h-11" value={brandId} onChange={(e) => setBrand(e.target.value)} aria-label="Filtrar por marca">
              <option value="">Todas as marcas</option>
              {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select className="h-11" value={categoryId} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar por categoria">
              <option value="">Todas as categorias</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {brands.data?.map((b) => (
              <button key={b.id} onClick={() => setBrand(brandId === b.id ? '' : b.id)} className={cx('rounded-full border px-3 py-1 text-xs', brandId === b.id ? 'border-navy-900 bg-navy-900 text-white' : 'border-line bg-white hover:bg-navy-50')}>
                {b.name}
              </button>
            ))}
            {cfg.stockEnabled && (
              <label className="ml-auto flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" className="accent-navy-800" checked={onlyAvailable} onChange={(e) => setAvail(e.target.checked)} /> Somente disponíveis
              </label>
            )}
          </div>
        </div>
        {cat.isLoading ? (
          <Loading label="Carregando catálogo…" />
        ) : cat.data?.brands.length === 0 ? (
          <Card><EmptyState icon={<PackageSearch className="size-6" />} title="Nenhum produto encontrado" description="Tente outro termo de pesquisa ou remova os filtros." /></Card>
        ) : (
          <div className={cx('space-y-8', cat.isFetching && 'opacity-70')}>
            {cat.data?.brands.map((b) => (
              <section key={b.id}>
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-base font-semibold text-navy-900">{b.name}</h3>
                  <span className="h-px flex-1 bg-gradient-to-r from-gold-300 to-transparent" />
                  <span className="text-xs text-muted">{b.products.length} produto(s)</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {b.products.map((p) => (
                    <ProductCard key={p.id} p={p} inCart={s.items.find((i) => i.productId === p.id)?.quantity} onAdd={onAdd} stockEnabled={cfg.stockEnabled} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <aside className="xl:sticky xl:top-20 xl:h-fit">
        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-navy-900"><ShoppingCart className="size-4 text-gold-500" /> Itens adicionados</h3>
            <span className="rounded-full bg-navy-900 px-2 py-0.5 text-xs font-semibold text-white">{s.items.length}</span>
          </div>
          {s.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Nenhum produto ainda. Use “Adicionar” nos cartões.</p>
          ) : (
            <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto">
              {s.items.map((i) => (
                <li key={i.productId} className="flex items-center gap-3 px-4 py-2.5">
                  <ProductThumb fileName={i.imageFileName} alt={i.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-muted">{i.sku} • {formatBRL(i.unitPriceCents * i.quantity)}</p>
                  </div>
                  <QtyStepper value={i.quantity} onChange={(v) => onQty(i.productId, v)} />
                  <button className="text-muted hover:text-red-600" onClick={() => onRemove(i.productId)} aria-label={`Remover ${i.name}`}><Trash2 className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    </div>
  );
}

function QtyStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-line">
      <button className="px-1.5 py-1 text-muted hover:text-navy-900 disabled:opacity-30" disabled={value <= 1} onClick={() => onChange(value - 1)} aria-label="Diminuir"><Minus className="size-3.5" /></button>
      <input className="w-10 bg-transparent text-center text-sm tabular outline-none" inputMode="numeric" value={value} onChange={(e) => onChange(parseInt(e.target.value.replace(/\D/g, '') || '1', 10))} aria-label="Quantidade" />
      <button className="px-1.5 py-1 text-muted hover:text-navy-900" onClick={() => onChange(value + 1)} aria-label="Aumentar"><Plus className="size-3.5" /></button>
    </div>
  );
}

function ProductCard({ p, inCart, onAdd, stockEnabled }: { p: CatalogProduct; inCart?: number; onAdd: (p: CatalogProduct, q: number) => void; stockEnabled: boolean }) {
  const [qty, setQty] = useState('1');
  const unavailable = stockEnabled && p.availableQty !== null && p.availableQty <= 0;
  const add = () => onAdd(p, parseInt(qty, 10));
  return (
    <div className={cx('flex gap-3 rounded-xl border bg-white p-3 transition', inCart ? 'border-gold-300 ring-1 ring-gold-200' : 'border-line hover:border-navy-200')}>
      <ProductThumb fileName={p.imageFileName} alt={p.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-navy-900">{p.name}</p>
        <p className="text-xs text-muted">{p.sku} • {p.brand.name}</p>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <p className="text-base font-semibold tabular text-navy-900">{formatBRL(p.priceCents)}<span className="text-xs font-normal text-muted"> /{p.unit}</span></p>
          {stockEnabled && p.availableQty !== null && <span className={cx('text-xs', unavailable ? 'text-red-600' : 'text-muted')}>{unavailable ? 'Indisponível' : `${p.availableQty} disp.`}</span>}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Input className="h-9 w-20 text-center tabular" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label={`Quantidade de ${p.name}`} />
          <Button size="sm" className="h-9 flex-1" variant={inCart ? 'secondary' : 'primary'} icon={<Plus className="size-4" />} onClick={add}>
            {inCart ? `No pedido (${inCart})` : 'Adicionar ao pedido'}
          </Button>
        </div>
        {unavailable && <p className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="size-3" /> Sem saldo em estoque.</p>}
      </div>
    </div>
  );
}

// ======================================================================== Etapa 3
function StepReview({ s, cfg, calc, update, onQty, onRemove }: { s: WizardState; cfg: SellerConfig; calc: CalcResult | null; update: (p: Partial<WizardState>) => void; onQty: (id: string, q: number) => void; onRemove: (id: string) => void }) {
  const setDisc = (pid: string, bps: number | null) => update({ items: s.items.map((i) => (i.productId === pid ? { ...i, discountBps: bps ?? 0 } : i)) });
  if (!s.items.length) return <Card><EmptyState title="Nenhum produto adicionado" action={<Button onClick={() => update({ step: 1 })}>Adicionar produtos</Button>} /></Card>;
  return (
    <Card padded={false}>
      <div className="p-5 pb-3"><CardTitle className="mb-0">Revisão dos produtos</CardTitle></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line bg-slate-50/70 text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 text-left font-semibold">Produto</th>
              <th className="px-4 py-2.5 text-left font-semibold">Marca</th>
              <th className="px-4 py-2.5 text-center font-semibold">Quantidade</th>
              <th className="px-4 py-2.5 text-right font-semibold">Preço unit.</th>
              {cfg.allowItemDiscount && <th className="px-4 py-2.5 text-right font-semibold">Desc. item</th>}
              <th className="px-4 py-2.5 text-right font-semibold">Subtotal</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {s.items.map((i, idx) => {
              const line = calc?.lines[idx];
              return (
                <tr key={i.productId} className="border-b border-line/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ProductThumb fileName={i.imageFileName} alt={i.name} size="sm" />
                      <div><p className="font-medium text-navy-900">{i.name}</p><p className="text-xs text-muted">{i.sku}</p></div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{i.brandName}</td>
                  <td className="px-4 py-3"><div className="flex justify-center"><QtyStepper value={i.quantity} onChange={(v) => onQty(i.productId, v)} /></div></td>
                  <td className="px-4 py-3 text-right tabular">{formatBRL(i.unitPriceCents)}</td>
                  {cfg.allowItemDiscount && (
                    <td className="px-4 py-3"><div className="ml-auto w-24"><PercentInput value={i.discountBps} onChange={(v) => setDisc(i.productId, v)} aria-label={`Desconto do item ${i.name}`} /></div></td>
                  )}
                  <td className="px-4 py-3 text-right font-medium tabular">{line ? formatBRL(line.netBeforeGeneralCents) : '—'}</td>
                  <td className="px-4 py-3 text-right"><button className="text-muted hover:text-red-600" onClick={() => onRemove(i.productId)} aria-label={`Remover ${i.name}`}><Trash2 className="size-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between p-4">
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => update({ step: 1 })}>Adicionar mais produtos</Button>
        <p className="self-center text-sm text-muted">Subtotal após descontos dos itens: <strong className="tabular text-ink">{formatBRL(calc?.subtotalAfterItemDiscountCents ?? 0)}</strong></p>
      </div>
    </Card>
  );
}

// ======================================================================== Etapa 4
function StepFinance({ s, cfg, calc, check, update }: { s: WizardState; cfg: SellerConfig; calc: CalcResult | null; check: { withinLimit: boolean; reasons: string[] } | null; update: (p: Partial<WizardState>) => void }) {
  const over = !!check && !check.withinLimit;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardTitle icon={<BadgePercent className="size-4" />}>Descontos e acréscimos</CardTitle>
        <div className="space-y-5">
          <Field label="Desconto do vendedor (%)" hint={`Seu limite: ${formatBps(cfg.maxDiscountBps)}. O valor é recalculado automaticamente.`}>
            <PercentInput value={s.generalDiscountBps} invalid={over} onChange={(v) => update({ generalDiscountBps: v ?? 0 })} className="h-12 text-lg" aria-label="Desconto do vendedor em percentual" />
          </Field>
          {calc && (
            <div className="rounded-lg bg-navy-50/70 p-4 text-sm">
              <div className="flex justify-between"><span className="text-muted">Base do desconto</span><span className="tabular">{formatBRL(calc.subtotalAfterItemDiscountCents)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Desconto geral em reais</span><span className="tabular font-medium text-red-600">−{formatBRL(calc.generalDiscountCents)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Total após desconto</span><span className="tabular font-medium">{formatBRL(calc.subtotalAfterItemDiscountCents - calc.generalDiscountCents)}</span></div>
            </div>
          )}
          {cfg.allowSellerFreight && (
            <Field label="Frete" hint="Se aplicável.">
              <MoneyInput value={s.freightCents} onChange={(v) => update({ freightCents: v ?? 0 })} />
            </Field>
          )}
          {over ? (
            <>
              <Alert tone="amber" title="Desconto acima do seu limite">
                <ul className="list-disc pl-4">{check!.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <p className="mt-1">O {`pedido`} não pode ser confirmado automaticamente. Reduza o desconto ou solicite aprovação do administrador.</p>
              </Alert>
              <Field label="Justificativa para o administrador" required>
                <Textarea rows={3} value={s.discountReason} onChange={(e) => update({ discountReason: e.target.value })} placeholder="Ex.: cliente novo com volume alto, concorrência com preço menor…" />
              </Field>
            </>
          ) : (
            calc && calc.totalDiscountCents > 0 && <Alert tone="green" icon={<CheckCircle2 className="size-4" />}>Desconto dentro do seu limite.</Alert>
          )}
        </div>
      </Card>
      <SummaryCard calc={calc} />
    </div>
  );
}

function SummaryCard({ calc }: { calc: CalcResult | null }) {
  if (!calc) return <Card><EmptyState title="Adicione produtos para ver os valores" /></Card>;
  const rows: [string, string, string?][] = [
    ['Quantidade total de itens', `${calc.totalQuantity} un. (${calc.itemCount} produto${calc.itemCount === 1 ? '' : 's'})`],
    ['Subtotal bruto', formatBRL(calc.grossCents)],
    ['Desconto por item', calc.itemDiscountCents ? `−${formatBRL(calc.itemDiscountCents)}` : formatBRL(0), calc.itemDiscountCents ? 'text-red-600' : undefined],
    [`Desconto geral (${formatBps(calc.generalDiscountBps)})`, calc.generalDiscountCents ? `−${formatBRL(calc.generalDiscountCents)}` : formatBRL(0), calc.generalDiscountCents ? 'text-red-600' : undefined],
    ...calc.surcharges.map((x) => [`${x.name} (${formatBps(x.rateBps)})`, `+${formatBRL(x.amountCents)}`] as [string, string]),
    ['Frete', calc.freightCents ? `+${formatBRL(calc.freightCents)}` : formatBRL(0)],
  ];
  return (
    <Card>
      <CardTitle>Resumo financeiro</CardTitle>
      <dl className="space-y-2.5 text-sm">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className={cx('tabular', cls)}>{v}</dd></div>
        ))}
      </dl>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-navy-900 px-5 py-4 text-white">
        <span className="font-medium">Valor final</span>
        <span className="text-2xl font-semibold tabular">{formatBRL(calc.totalCents)}</span>
      </div>
      {calc.totalDiscountCents > 0 && <p className="mt-2 text-right text-xs text-muted">Desconto efetivo total: {formatBps(calc.effectiveDiscountBps)}</p>}
      <details className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer text-navy-700">Como os valores foram calculados</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">{calc.steps.map((st) => <li key={st}>{st}</li>)}</ol>
      </details>
    </Card>
  );
}

// ======================================================================== Etapa 5
function StepConfirm({ s, cfg, calc, client, sellerName, isQuote, overLimit, reasons, children }: { s: WizardState; cfg: SellerConfig; calc: CalcResult | null; client: any; sellerName: string; isQuote: boolean; overLimit: boolean; reasons: string[]; children: React.ReactNode }) {
  // validação dos valores pelo servidor (preços atuais do banco)
  const preview = useQuery({
    queryKey: ['preview', s.items, s.generalDiscountBps, s.freightCents],
    queryFn: () => api<{ calc: CalcResult }>('/seller/pricing/preview', { body: { items: s.items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountBps: i.discountBps })), generalDiscountBps: s.generalDiscountBps, freightCents: s.freightCents } }),
    retry: false,
  });
  const server = preview.data?.calc;
  const differs = server && calc && server.totalCents !== calc.totalCents;
  const term = cfg.paymentTerms.find((t) => t.id === s.paymentTermId);
  const shown = server ?? calc;
  return (
    <div className="space-y-6">
      {preview.isError && <Alert tone="red" title="Não foi possível validar os valores">{errorMessage(preview.error)}</Alert>}
      {differs && <Alert tone="amber" title="Preços atualizados">Alguns preços do catálogo mudaram. Os valores abaixo já consideram os preços atuais (calculados pelo servidor).</Alert>}
      {overLimit && <Alert tone="amber" title="Aprovação necessária">{reasons.join(' ')}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Resumo {isQuote ? 'do orçamento' : 'do pedido'}</CardTitle>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs uppercase tracking-wide text-muted">Cliente</dt><dd className="font-medium">{client?.legalName}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">CNPJ</dt><dd className="tabular">{client && formatCnpj(client.cnpj)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Vendedor</dt><dd>{sellerName}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Data</dt><dd>{formatDateBR(cfg.today)}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Condição de pagamento</dt><dd>{term ? `${term.name}${term.days ? ` (${term.days} dias)` : ''}` : 'A combinar'}</dd></div>
            <div><dt className="text-xs uppercase tracking-wide text-muted">Previsão de entrega</dt><dd>{s.expectedDelivery ? formatDateBR(s.expectedDelivery) : '—'}</dd></div>
            {isQuote && <div><dt className="text-xs uppercase tracking-wide text-muted">Validade da proposta</dt><dd>{s.validUntil ? formatDateBR(s.validUntil) : '—'}</dd></div>}
            <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wide text-muted">Observações</dt><dd className="whitespace-pre-wrap">{s.notes || '—'}</dd></div>
          </dl>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="py-2 text-left font-semibold">Produto</th><th className="py-2 text-right font-semibold">Qtd.</th><th className="py-2 text-right font-semibold">Unitário</th><th className="py-2 text-right font-semibold">Subtotal</th></tr></thead>
              <tbody>
                {s.items.map((i, idx) => (
                  <tr key={i.productId} className="border-b border-line/60">
                    <td className="py-2"><p className="font-medium">{i.name}</p><p className="text-xs text-muted">{i.sku} • {i.brandName}{i.discountBps ? ` • desc. ${formatBps(i.discountBps)}` : ''}</p></td>
                    <td className="py-2 text-right tabular">{i.quantity}</td>
                    <td className="py-2 text-right tabular">{formatBRL(shown?.lines[idx]?.unitPriceCents ?? i.unitPriceCents)}</td>
                    <td className="py-2 text-right font-medium tabular">{formatBRL(shown?.lines[idx]?.netBeforeGeneralCents ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-4">
          <SummaryCard calc={shown ?? null} />
          {server && <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" /> Valores validados pelo servidor.</p>}
        </div>
      </div>
      <Card>{children}</Card>
    </div>
  );
}
