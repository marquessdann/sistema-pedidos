import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImagePlus, Lock, Save, Star, Trash2 } from 'lucide-react';
import { formatBRL, formatBps, formatDateTimeBR, mulBps } from '@della/shared';
import { api, errorMessage, fieldErrors, fileUrl } from '../../lib/api';
import { shrinkProductImage } from '../../lib/image';
import { useConfirm } from '../../components/ui';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, Loading, MoneyInput, PageHeader, PercentInput, Select, Textarea, Toggle, cx } from '../../components/ui';

const EMPTY = {
  sku: '',
  name: '',
  brandId: '',
  categoryId: '',
  description: '',
  unit: 'UN',
  unitsPerBox: null as number | null,
  boxOnly: false,
  costCents: 0 as number | null,
  taxRefBps: null as number | null,
  priceCents: null as number | null,
  stockQty: 0,
  active: true,
  internalNotes: '',
};

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((p) => ({ ...p, [k]: v }));

  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api<{ id: string; name: string; active: boolean }[]>('/admin/brands') });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ id: string; name: string }[]>('/admin/categories') });
  const existing = useQuery({ queryKey: ['product', id], queryFn: () => api<any>(`/admin/products/${id}`), enabled: !isNew });

  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setF({
      sku: p.sku,
      name: p.name,
      brandId: p.brandId,
      categoryId: p.categoryId ?? '',
      description: p.description ?? '',
      unit: p.unit,
      unitsPerBox: p.unitsPerBox ?? null,
      boxOnly: !!p.boxOnly,
      costCents: p.costCents,
      taxRefBps: p.taxRefBps || null,
      priceCents: p.priceCents,
      stockQty: p.stockQty,
      active: p.active,
      internalNotes: p.internalNotes ?? '',
    });
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, categoryId: f.categoryId || null, costCents: f.costCents ?? 0, taxRefBps: f.taxRefBps ?? 0, priceCents: f.priceCents ?? undefined, stockQty: isNew ? f.stockQty : undefined };
      return isNew ? api('/admin/products', { body }) : api(`/admin/products/${id}`, { method: 'PUT', body });
    },
    onSuccess: (p: any) => {
      toast.success(isNew ? 'Produto cadastrado. Agora você pode adicionar imagens.' : 'Produto atualizado.');
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['product', id] });
      if (isNew) nav(`/admin/produtos/${p.id}`, { replace: true });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });

  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData();
      return (async () => {
        for (const file of Array.from(files)) {
          const { blob, ext } = await shrinkProductImage(file);
          fd.append('images', blob, file.name.replace(/\.\w+$/, `.${ext}`));
        }
        return api(`/admin/products/${id}/images`, { form: fd });
      })();
    },
    onSuccess: () => {
      toast.success('Imagens enviadas.');
      void qc.invalidateQueries({ queryKey: ['product', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const imgAction = useMutation({
    mutationFn: ({ imageId, action }: { imageId: string; action: 'primary' | 'delete' }) =>
      action === 'primary' ? api(`/admin/products/${id}/images/${imageId}/primary`, { body: {} }) : api(`/admin/products/${id}/images/${imageId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product', id] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!isNew && existing.isLoading) return <Loading />;
  const price = f.priceCents ?? 0;
  const cost = f.costCents ?? 0;
  const tax = mulBps(price, f.taxRefBps ?? 0);
  const margin = price - cost - tax;
  const marginBps = price > 0 ? Math.round((margin * 10000) / price) : null;
  const markupBps = cost > 0 ? Math.round(((price - cost) * 10000) / cost) : null;
  const err = (k: string) => errors[k];

  return (
    <>
      <PageHeader
        back="/admin/produtos"
        title={isNew ? 'Novo produto' : f.name}
        subtitle={!isNew && <span className="inline-flex items-center gap-2">{f.sku} {f.active ? <Badge tone="green">Ativo</Badge> : <Badge>Inativo</Badge>}</span>}
        actions={<Button icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>Salvar produto</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardTitle>Identificação</CardTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Código / SKU" required error={err('sku')}>
                <Input value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} invalid={!!err('sku')} />
              </Field>
              <Field label="Nome do produto" required error={err('name')} className="sm:col-span-2">
                <Input value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!err('name')} />
              </Field>
              <Field label="Marca" required error={err('brandId')}>
                <Select value={f.brandId} onChange={(e) => set('brandId', e.target.value)} invalid={!!err('brandId')}>
                  <option value="">Selecione…</option>
                  {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}{!b.active ? ' (inativa)' : ''}</option>)}
                </Select>
              </Field>
              <Field label="Categoria" error={err('categoryId')}>
                <Select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">Sem categoria</option>
                  {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Unidade de medida" error={err('unit')} hint="Ex.: UN, CX, KG, PCT">
                <Input value={f.unit} maxLength={10} onChange={(e) => set('unit', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Unidades por caixa" error={err('unitsPerBox')} hint="Opcional. Preenchido = o vendedor pode vender por CX ou UN (preço da caixa = preço × unidades).">
                <Input type="number" inputMode="numeric" min={2} value={f.unitsPerBox ?? ''} onChange={(e) => set('unitsPerBox', e.target.value ? parseInt(e.target.value, 10) : null)} placeholder="Ex.: 12" />
              </Field>
              {f.unitsPerBox && f.unitsPerBox >= 2 ? (
                <div className="sm:col-span-3">
                  <Toggle checked={f.boxOnly} onChange={(v) => set('boxOnly', v)} label="Vender somente por caixa" description="O vendedor só vê a caixa fechada e o estoque em caixas." />
                </div>
              ) : null}
              {f.unitsPerBox && f.unitsPerBox >= 2 && f.priceCents ? (
                <div className="flex items-end sm:col-span-2">
                  <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-700">Preço da caixa com {f.unitsPerBox} {f.unit}: <strong className="tabular">{formatBRL(f.priceCents * f.unitsPerBox)}</strong></p>
                </div>
              ) : null}
              <Field label="Descrição" className="sm:col-span-3">
                <Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </div>
          </Card>
          <Card>
            <CardTitle icon={<Lock className="size-4" />}>Preços e tributos (informações restritas)</CardTitle>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Preço de custo" error={err('costCents')}>
                <MoneyInput value={f.costCents} onChange={(v) => set('costCents', v)} />
              </Field>
              <Field label="Tributo de referência" error={err('taxRefBps')} hint="Deixe em branco se ainda não souber; a margem é recalculada quando você preencher.">
                <PercentInput value={f.taxRefBps} onChange={(v) => set('taxRefBps', v)} />
              </Field>
              <Field label="Preço de venda (comercial)" required error={err('priceCents')} hint="Este é o preço exibido ao vendedor.">
                <MoneyInput value={f.priceCents} onChange={(v) => set('priceCents', v)} invalid={!!err('priceCents')} />
              </Field>
            </div>
            <div className="mt-5 grid gap-3 rounded-lg bg-navy-50/60 p-4 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted">Custo</p><p className="font-medium tabular">{formatBRL(cost)}</p></div>
              <div><p className="text-xs text-muted">Tributo estimado</p><p className="font-medium tabular">{formatBRL(tax)}</p></div>
              <div><p className="text-xs text-muted">Margem estimada</p><p className={cx('font-medium tabular', margin < 0 && 'text-red-600')}>{formatBRL(margin)} {marginBps !== null && `(${formatBps(marginBps, 1)})`}</p></div>
              <div><p className="text-xs text-muted">Markup sobre custo</p><p className="font-medium tabular">{markupBps === null ? '—' : formatBps(markupBps, 1)}</p></div>
            </div>
            <p className="mt-3 text-xs text-muted">O percentual tributário é uma referência de cálculo comercial, não a tributação fiscal definitiva. Valide as alíquotas com o contador.</p>
          </Card>
          {!isNew && existing.data?.priceHistory?.length > 0 && (
            <Card>
              <CardTitle>Histórico de preços</CardTitle>
              <ul className="divide-y divide-line text-sm">
                {existing.data.priceHistory.map((h: any) => (
                  <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className="text-muted">{formatDateTimeBR(h.createdAt)}</span>
                    <span className="tabular">Venda: {h.oldPriceCents !== null ? `${formatBRL(h.oldPriceCents)} → ` : ''}{formatBRL(h.newPriceCents)} • Custo: {h.oldCostCents !== null ? `${formatBRL(h.oldCostCents)} → ` : ''}{formatBRL(h.newCostCents)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardTitle>Imagens</CardTitle>
            {isNew ? (
              <p className="text-sm text-muted">Salve o produto para adicionar a imagem principal e as adicionais.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {existing.data?.images.map((img: any) => (
                    <div key={img.id} className={cx('group relative overflow-hidden rounded-lg border', img.isPrimary ? 'border-gold-400 ring-2 ring-gold-200' : 'border-line')}>
                      <img src={fileUrl.product(img.fileName)!} alt="" className="aspect-square w-full bg-white object-contain" />
                      {img.isPrimary && <span className="absolute left-1 top-1 rounded bg-gold-500 px-1.5 text-[10px] font-semibold text-white">Principal</span>}
                      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-navy-950/60 p-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        {!img.isPrimary && <button className="rounded p-1 text-white hover:bg-white/20" title="Definir como principal" aria-label="Definir como principal" onClick={() => imgAction.mutate({ imageId: img.id, action: 'primary' })}><Star className="size-4" /></button>}
                        <button className="rounded p-1 text-white hover:bg-white/20" title="Remover" aria-label="Remover imagem" onClick={async () => (await confirm({ title: 'Remover imagem?', message: 'A imagem será removida do produto.', tone: 'danger', confirmLabel: 'Remover' })) && imgAction.mutate({ imageId: img.id, action: 'delete' })}><Trash2 className="size-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
                <Button variant="secondary" className="mt-3 w-full" icon={<ImagePlus className="size-4" />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                  Adicionar imagens
                </Button>
                <p className="mt-2 text-xs text-muted">PNG, JPG ou WEBP. Fotos do celular são reduzidas automaticamente antes do envio.</p>
              </>
            )}
          </Card>
          <Card>
            <CardTitle>Disponibilidade</CardTitle>
            <div className="space-y-4">
              <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Produto ativo" description="Produtos inativos não aparecem para os vendedores." />
              <Field label="Estoque atual" hint={isNew ? 'Opcional. Registrado como entrada inicial.' : 'Alterações de estoque são feitas em “Estoque”, com justificativa.'}>
                <Input type="number" min={0} value={f.stockQty} disabled={!isNew} onChange={(e) => set('stockQty', Math.max(0, parseInt(e.target.value || '0', 10)))} />
              </Field>
              {!isNew && existing.data && existing.data.reservedQty > 0 && <Alert tone="blue">{existing.data.reservedQty} unidade(s) reservada(s) em pedidos.</Alert>}
            </div>
          </Card>
          <Card>
            <CardTitle>Observações internas</CardTitle>
            <Textarea rows={4} value={f.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} placeholder="Visível somente para administradores." />
          </Card>
        </div>
      </div>
    </>
  );
}
