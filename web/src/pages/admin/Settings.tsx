import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ImagePlus, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import {
  CONVERSION_PRICE_POLICY_LABELS,
  DEFAULT_ORDER_TRANSITIONS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_TERMINAL_STATUSES,
  STOCK_POLICY_LABELS,
  formatBps,
  formatCnpj,
  formatDateTimeBR,
  formatPhone,
  type OrderStatus,
} from '@della/shared';
import { api, errorMessage, fieldErrors, fileUrl } from '../../lib/api';
import { Alert, Badge, Button, Card, CardTitle, DataTable, Field, Input, MaskedInput, Modal, PageHeader, PercentInput, Select, Tabs, Textarea, Toggle, cx, useConfirm } from '../../components/ui';

type Tab = 'empresa' | 'comercial' | 'pagamento' | 'tributos' | 'status' | 'usuarios';

export default function Settings() {
  const [tab, setTab] = useState<Tab>('empresa');
  return (
    <>
      <PageHeader title="Configurações" subtitle="Empresa, regras comerciais, tributos, status e usuários" />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'empresa', label: 'Empresa e documentos' },
        { value: 'comercial', label: 'Regras comerciais' },
        { value: 'pagamento', label: 'Condições de pagamento' },
        { value: 'tributos', label: 'Tributos e acréscimos' },
        { value: 'status', label: 'Fluxo de status' },
        { value: 'usuarios', label: 'Administradores' },
      ]} />
      {tab === 'empresa' && <CompanyTab />}
      {tab === 'comercial' && <CommercialTab />}
      {tab === 'pagamento' && <PaymentTermsTab />}
      {tab === 'tributos' && <RulesTab />}
      {tab === 'status' && <TransitionsTab />}
      {tab === 'usuarios' && <UsersTab />}
    </>
  );
}

function useSettingsForm() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<any>('/admin/settings') });
  const [f, setF] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setF({ ...q.data, cnpj: formatCnpj(q.data.cnpj ?? ''), phone: formatPhone(q.data.phone) }); }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const { id: _i, updatedAt: _u, updatedById: _b, logoFileName: _l, integrations: _g, ...body } = f;
      return api('/admin/settings', { method: 'PUT', body: { ...body, cnpj: body.cnpj || null } });
    },
    onSuccess: () => { toast.success('Configurações salvas.'); setErrors({}); void qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(errorMessage(e)); },
  });
  return { q, f, setF, save, errors, qc };
}

function CompanyTab() {
  const { q, f, setF, save, errors, qc } = useSettingsForm();
  const logoRef = useRef<HTMLInputElement>(null);
  const [logoVer, setLogoVer] = useState(0);
  const upload = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('logo', file); return api('/admin/settings/logo', { form: fd }); },
    onSuccess: () => { toast.success('Logotipo atualizado.'); setLogoVer((v) => v + 1); void qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: () => api('/admin/settings/logo', { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }) });
  if (!f) return null;
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardTitle actions={<Button icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>Dados da empresa (aparecem no PDF)</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome da empresa" required error={errors.companyName}><Input value={f.companyName} onChange={(e) => set('companyName', e.target.value)} /></Field>
          <Field label="Razão social" error={errors.legalName}><Input value={f.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} /></Field>
          <Field label="CNPJ" error={errors.cnpj}><MaskedInput value={f.cnpj ?? ''} mask={formatCnpj} inputMode="text" onChange={(v) => set('cnpj', v)} /></Field>
          <Field label="Inscrição estadual" error={errors.stateRegistration}><Input value={f.stateRegistration ?? ''} onChange={(e) => set('stateRegistration', e.target.value)} /></Field>
          <Field label="Telefone" error={errors.phone}><MaskedInput value={f.phone ?? ''} mask={formatPhone} onChange={(v) => set('phone', v)} /></Field>
          <Field label="E-mail" error={errors.email}><Input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Site" error={errors.website}><Input value={f.website ?? ''} onChange={(e) => set('website', e.target.value)} /></Field>
          <Field label="Fuso horário" error={errors.timezone} hint="Usado para a data dos pedidos."><Input value={f.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
          <Field label="Endereço completo" className="sm:col-span-2" error={errors.address}><Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Rodapé do PDF" className="sm:col-span-2" error={errors.pdfFooterText}><Input value={f.pdfFooterText ?? ''} onChange={(e) => set('pdfFooterText', e.target.value)} placeholder="Ex.: Della Comércio Ltda • www.della.com.br" /></Field>
          <Field label="Condições gerais do orçamento (PDF)" className="sm:col-span-2" error={errors.quoteTerms}><Textarea rows={3} value={f.quoteTerms ?? ''} onChange={(e) => set('quoteTerms', e.target.value)} placeholder="Ex.: Preços sujeitos a alteração após a validade. Frete conforme negociação." /></Field>
        </div>
      </Card>
      <Card>
        <CardTitle>Logotipo</CardTitle>
        <div className="flex h-36 items-center justify-center rounded-lg border border-dashed border-line bg-slate-50">
          {q.data?.logoFileName ? <img src={`${fileUrl.logo}?v=${logoVer}`} alt="Logotipo" className="max-h-28 max-w-[80%] object-contain" /> : <p className="px-4 text-center text-sm text-muted">Sem logotipo: o PDF usa o nome da empresa estilizado.</p>}
        </div>
        <input ref={logoRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" icon={<ImagePlus className="size-4" />} loading={upload.isPending} onClick={() => logoRef.current?.click()}>Enviar logotipo</Button>
          {q.data?.logoFileName && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => remove.mutate()}>Remover</Button>}
        </div>
        <p className="mt-2 text-xs text-muted">PNG ou JPG, até 5 MB.</p>
        <div className="mt-6 border-t border-line pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Integrações</p>
          <ul className="space-y-1 text-sm">
            <li>E-mail (SMTP): {q.data?.integrations.email ? <Badge tone="green">Configurado</Badge> : <Badge>Não configurado</Badge>}</li>
            <li>WhatsApp Business API: {q.data?.integrations.whatsappApi ? <Badge tone="green">Credenciais presentes</Badge> : <Badge>Não configurado</Badge>}</li>
          </ul>
          <p className="mt-2 text-xs text-muted">Credenciais são definidas por variáveis de ambiente no servidor.</p>
        </div>
      </Card>
    </div>
  );
}

function CommercialTab() {
  const { f, setF, save, errors } = useSettingsForm();
  if (!f) return null;
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardTitle actions={<Button icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>}>Pedidos e orçamentos</CardTitle>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Validade padrão (dias)" error={errors.quoteValidityDays}><Input type="number" min={1} value={f.quoteValidityDays} onChange={(e) => set('quoteValidityDays', parseInt(e.target.value || '0', 10))} /></Field>
            <Field label="Prefixo pedidos" error={errors.orderNumberPrefix}><Input value={f.orderNumberPrefix} onChange={(e) => set('orderNumberPrefix', e.target.value.toUpperCase())} /></Field>
            <Field label="Prefixo orçamentos" error={errors.quoteNumberPrefix}><Input value={f.quoteNumberPrefix} onChange={(e) => set('quoteNumberPrefix', e.target.value.toUpperCase())} /></Field>
          </div>
          <Toggle checked={f.allowItemDiscount} onChange={(v) => set('allowItemDiscount', v)} label="Permitir desconto por item" description="Além do desconto geral do pedido." />
          <Toggle checked={f.allowSellerFreight} onChange={(v) => set('allowSellerFreight', v)} label="Vendedor pode informar frete" />
          <Field label="Preço na conversão de orçamento em pedido" hint="Em ambos os casos o vendedor é avisado quando houver diferença de preço.">
            <Select value={f.conversionPricePolicy} onChange={(e) => set('conversionPricePolicy', e.target.value)}>
              {Object.entries(CONVERSION_PRICE_POLICY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <Card>
        <CardTitle>Estoque</CardTitle>
        <div className="space-y-4">
          <Toggle checked={f.stockEnabled} onChange={(v) => set('stockEnabled', v)} label="Habilitar controle de estoque" description="Mantenha desabilitado até conferir os saldos ou integrar ao sistema de estoque." />
          <Field label="Política de reserva e baixa">
            <Select value={f.stockPolicy} disabled={!f.stockEnabled} onChange={(e) => set('stockPolicy', e.target.value)}>
              {Object.entries(STOCK_POLICY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Toggle checked={f.blockOnInsufficientStock} disabled={!f.stockEnabled} onChange={(v) => set('blockOnInsufficientStock', v)} label="Bloquear pedidos sem saldo disponível" />
          <Alert tone="blue">Orçamentos nunca reservam nem baixam estoque.</Alert>
        </div>
      </Card>
    </div>
  );
}

function PaymentTermsTab() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<any>(null);
  const list = useQuery({ queryKey: ['payment-terms'], queryFn: () => api<any[]>('/admin/payment-terms') });
  const save = useMutation({
    mutationFn: () => (edit.id ? api(`/admin/payment-terms/${edit.id}`, { method: 'PUT', body: edit }) : api('/admin/payment-terms', { body: edit })),
    onSuccess: () => { toast.success('Salvo.'); setEdit(null); void qc.invalidateQueries({ queryKey: ['payment-terms'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card padded={false}>
      <div className="p-5 pb-3"><CardTitle className="mb-0" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', days: '', active: true, sortOrder: 0 })}>Nova condição</Button>}>Condições de pagamento</CardTitle></div>
      <DataTable rows={list.data} loading={list.isLoading} rowKey={(r: any) => r.id} onRowClick={(r: any) => setEdit({ id: r.id, name: r.name, days: r.days ?? '', active: r.active, sortOrder: r.sortOrder })}
        columns={[
          { key: 'n', header: 'Nome', render: (r: any) => <span className="font-medium">{r.name}</span> },
          { key: 'd', header: 'Prazos (dias)', render: (r: any) => r.days ?? '—' },
          { key: 's', header: 'Status', render: (r: any) => (r.active ? <Badge tone="green">Ativa</Badge> : <Badge>Inativa</Badge>) },
        ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar condição' : 'Nova condição'} size="sm" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
        {edit && <div className="space-y-4">
          <Field label="Nome"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ex.: 30/60/90 dias" /></Field>
          <Field label="Prazos (dias)" hint="Ex.: 30/60/90. Deixe vazio para à vista."><Input value={edit.days} onChange={(e) => setEdit({ ...edit, days: e.target.value })} /></Field>
          <Field label="Ordem"><Input type="number" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: parseInt(e.target.value || '0', 10) })} /></Field>
          <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativa" />
        </div>}
      </Modal>
    </Card>
  );
}

function RulesTab() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<any>(null);
  const list = useQuery({ queryKey: ['pricing-rules'], queryFn: () => api<any[]>('/admin/pricing-rules') });
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => api<any[]>('/admin/brands') });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<any[]>('/admin/categories') });
  const products = useQuery({ queryKey: ['products-for-rules'], queryFn: () => api<any>('/admin/products', { query: { pageSize: 200 } }), enabled: edit?.scope === 'PRODUCT' });
  const save = useMutation({
    mutationFn: () => (edit.id ? api(`/admin/pricing-rules/${edit.id}`, { method: 'PUT', body: edit }) : api('/admin/pricing-rules', { body: edit })),
    onSuccess: () => { toast.success('Regra salva.'); setEdit(null); void qc.invalidateQueries({ queryKey: ['pricing-rules'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const scopeLabel = (r: any) => (r.scope === 'ALL' ? 'Todos os produtos' : r.scope === 'BRAND' ? `Marca: ${r.brand?.name}` : r.scope === 'CATEGORY' ? `Categoria: ${r.category?.name}` : `Produto: ${r.product?.sku}`);
  return (
    <div className="space-y-4">
      <Alert tone="amber" title="Não são alíquotas fiscais definitivas">Os percentuais cadastrados aqui são referências de cálculo comercial, informadas e validadas pela empresa e pelo contador. O sistema não sugere alíquotas.</Alert>
      <Card padded={false}>
        <div className="p-5 pb-3"><CardTitle className="mb-0" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', description: '', kind: 'INTERNAL_ESTIMATE', base: 'NET', scope: 'ALL', rateBps: 0, active: true })}>Nova regra</Button>}>Tributos e acréscimos</CardTitle></div>
        <DataTable rows={list.data} loading={list.isLoading} rowKey={(r: any) => r.id}
          empty={<p className="px-5 py-10 text-center text-sm text-muted">Nenhuma regra cadastrada. Sem regras, o total do pedido = subtotal − descontos + frete.</p>}
          columns={[
            { key: 'n', header: 'Regra', render: (r: any) => (<div><p className="font-medium">{r.name}</p>{r.description && <p className="text-xs text-muted">{r.description}</p>}</div>) },
            { key: 'k', header: 'Tipo', render: (r: any) => (r.kind === 'SURCHARGE' ? <Badge tone="gold">Acréscimo cobrado do cliente</Badge> : <Badge tone="navy">Tributo estimado (interno)</Badge>) },
            { key: 'r', header: 'Percentual', align: 'right', render: (r: any) => formatBps(r.rateBps) },
            { key: 'b', header: 'Base', render: (r: any) => (r.base === 'GROSS' ? 'Valor bruto do item' : 'Valor líquido (após descontos)') },
            { key: 's', header: 'Aplica-se a', render: scopeLabel },
            { key: 'a', header: 'Status', render: (r: any) => (r.active ? <Badge tone="green">Ativa</Badge> : <Badge>Inativa</Badge>) },
            { key: 'e', header: '', align: 'right', render: (r: any) => <Button size="sm" variant="ghost" aria-label="Editar" icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...r, brand: undefined, category: undefined, product: undefined, createdAt: undefined, updatedAt: undefined })} /> },
          ]} />
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar regra' : 'Nova regra'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button></>}>
        {edit && <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Tipo" className="sm:col-span-2">
            <Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
              <option value="INTERNAL_ESTIMATE">Tributo estimado — interno, só para cálculo de margem</option>
              <option value="SURCHARGE">Acréscimo — somado ao total e exibido ao cliente</option>
            </Select>
          </Field>
          <Field label="Percentual"><PercentInput value={edit.rateBps} onChange={(v) => setEdit({ ...edit, rateBps: v ?? 0 })} /></Field>
          <Field label="Base de cálculo">
            <Select value={edit.base} onChange={(e) => setEdit({ ...edit, base: e.target.value })}>
              <option value="NET">Valor líquido (após descontos)</option>
              <option value="GROSS">Valor bruto (antes dos descontos)</option>
            </Select>
          </Field>
          <Field label="Aplica-se a">
            <Select value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })}>
              <option value="ALL">Todos os produtos</option><option value="BRAND">Uma marca</option><option value="CATEGORY">Uma categoria</option><option value="PRODUCT">Um produto</option>
            </Select>
          </Field>
          {edit.scope === 'BRAND' && <Field label="Marca"><Select value={edit.brandId ?? ''} onChange={(e) => setEdit({ ...edit, brandId: e.target.value })}><option value="">Selecione</option>{brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
          {edit.scope === 'CATEGORY' && <Field label="Categoria"><Select value={edit.categoryId ?? ''} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value })}><option value="">Selecione</option>{cats.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
          {edit.scope === 'PRODUCT' && <Field label="Produto"><Select value={edit.productId ?? ''} onChange={(e) => setEdit({ ...edit, productId: e.target.value })}><option value="">Selecione</option>{products.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.sku} – {p.name}</option>)}</Select></Field>}
          <Field label="Descrição" className="sm:col-span-2"><Input value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="Ex.: validado pelo contador em 10/2026" /></Field>
          <div className="sm:col-span-2"><Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Regra ativa" /></div>
        </div>}
      </Modal>
    </div>
  );
}

function TransitionsTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['transitions'], queryFn: () => api<{ transitions: [string, string][] }>('/admin/status-transitions') });
  const [set, setSet] = useState<Set<string>>(new Set());
  useEffect(() => { if (q.data) setSet(new Set(q.data.transitions.map(([a, b]) => `${a}>${b}`))); }, [q.data]);
  const save = useMutation({
    mutationFn: (pairs: [string, string][]) => api('/admin/status-transitions', { method: 'PUT', body: { transitions: pairs } }),
    onSuccess: () => { toast.success('Fluxo de status salvo.'); void qc.invalidateQueries({ queryKey: ['transitions'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const from = ORDER_STATUSES.filter((s) => s !== 'DRAFT' && !ORDER_TERMINAL_STATUSES.includes(s));
  const to = ORDER_STATUSES.filter((s) => s !== 'DRAFT');
  const toggle = (k: string) => setSet((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  return (
    <Card>
      <CardTitle actions={<div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={async () => (await confirm({ title: 'Restaurar padrão?', message: 'O fluxo voltará às transições padrão do sistema.' })) && save.mutate(DEFAULT_ORDER_TRANSITIONS)}>Restaurar padrão</Button>
        <Button size="sm" icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate([...set].map((k) => k.split('>') as [string, string]))}>Salvar</Button>
      </div>}>Transições permitidas (de → para)</CardTitle>
      <p className="mb-4 text-sm text-muted">Marque para quais status cada status pode avançar. Pedidos concluídos, cancelados ou reprovados só mudam por “Reabrir pedido”, com justificativa.</p>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead><tr><th className="p-2 text-left text-muted">De \ Para</th>{to.map((s) => <th key={s} className="p-2 text-center font-medium text-muted"><span className="block w-20">{ORDER_STATUS_LABELS[s]}</span></th>)}</tr></thead>
          <tbody>
            {from.map((a) => (
              <tr key={a} className="border-t border-line">
                <td className="whitespace-nowrap p-2 font-medium text-navy-900">{ORDER_STATUS_LABELS[a as OrderStatus]}</td>
                {to.map((b) => (
                  <td key={b} className="p-2 text-center">
                    {a === b ? '—' : <input type="checkbox" className={cx('size-4 accent-navy-800')} checked={set.has(`${a}>${b}`)} onChange={() => toggle(`${a}>${b}`)} aria-label={`${ORDER_STATUS_LABELS[a as OrderStatus]} para ${ORDER_STATUS_LABELS[b]}`} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ username: '', name: '', password: '' });
  const list = useQuery({ queryKey: ['users'], queryFn: () => api<any[]>('/admin/users') });
  const create = useMutation({
    mutationFn: () => api('/admin/users', { body: f }),
    onSuccess: () => { toast.success('Administrador criado (troca de senha no primeiro acesso).'); setOpen(false); setF({ username: '', name: '', password: '' }); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (u: any) => api(`/admin/users/${u.id}/active`, { body: { active: !u.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card padded={false}>
      <div className="p-5 pb-3"><CardTitle className="mb-0" actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Novo administrador</Button>}>Usuários do sistema</CardTitle></div>
      <DataTable rows={list.data} loading={list.isLoading} rowKey={(r: any) => r.id}
        columns={[
          { key: 'n', header: 'Nome', render: (r: any) => <span className="font-medium">{r.name}</span> },
          { key: 'u', header: 'Usuário', render: (r: any) => r.username },
          { key: 'r', header: 'Perfil', render: (r: any) => (r.role === 'ADMIN' ? <Badge tone="navy">Administrador</Badge> : <Badge tone="gold">Vendedor</Badge>) },
          { key: 'l', header: 'Último acesso', hideOnMobile: true, render: (r: any) => (r.lastLoginAt ? formatDateTimeBR(r.lastLoginAt) : 'Nunca') },
          { key: 's', header: 'Status', render: (r: any) => (r.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="red">Inativo</Badge>) },
          { key: 'a', header: '', align: 'right', render: (r: any) => r.role === 'ADMIN' && <Button size="sm" variant="ghost" onClick={() => toggle.mutate(r)}>{r.active ? 'Desativar' : 'Ativar'}</Button> },
        ]} />
      <p className="px-5 py-3 text-xs text-muted">Vendedores são gerenciados em “Vendedores”.</p>
      <Modal open={open} onClose={() => setOpen(false)} title="Novo administrador" size="sm" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Criar</Button></>}>
        <div className="space-y-4">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Usuário"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></Field>
          <Field label="Senha provisória" hint="Troca obrigatória no primeiro acesso."><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  );
}
