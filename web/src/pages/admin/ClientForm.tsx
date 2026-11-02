import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ClipboardPaste, History, MapPin, Save, Wand2 } from 'lucide-react';
import {
  CLIENT_STATUS_LABELS,
  UFS,
  formatBRL,
  formatCep,
  formatCnpj,
  formatDateBR,
  formatDateTimeBR,
  formatPhone,
  isValidCnpj,
  onlyDigits,
  parseClientText,
  type ParsedClient,
} from '@della/shared';
import { api, errorMessage, fieldErrors } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Alert, Button, Card, CardTitle, Field, Input, KeyValue, Loading, MaskedInput, Modal, PageHeader, Select, Textarea, Toggle } from '../../components/ui';
import { ClientStatusBadge } from '../../components/common';

const EMPTY = {
  legalName: '',
  tradeName: '',
  cnpj: '',
  stateRegistration: '',
  responsibleName: '',
  financeEmail: '',
  financePhone: '',
  commercialPhone: '',
  commercialEmail: '',
  cep: '',
  state: '',
  city: '',
  district: '',
  street: '',
  number: '',
  complement: '',
  notes: '',
  status: 'PENDING_REGISTRATION',
  salesRepId: '',
  availableToAllReps: false,
};
type Form = typeof EMPTY;

export default function ClientForm() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const reps = useQuery({ queryKey: ['reps'], queryFn: () => api<{ id: string; fullName: string; active: boolean }[]>('/admin/reps') });
  const existing = useQuery({ queryKey: ['client', id], queryFn: () => api<any>(`/admin/clients/${id}`), enabled: !isNew });

  useEffect(() => {
    const c = existing.data;
    if (!c) return;
    setF({
      legalName: c.legalName ?? '',
      tradeName: c.tradeName ?? '',
      cnpj: formatCnpj(c.cnpj),
      stateRegistration: c.stateRegistration ?? '',
      responsibleName: c.responsibleName ?? '',
      financeEmail: c.financeEmail ?? '',
      financePhone: formatPhone(c.financePhone),
      commercialPhone: formatPhone(c.commercialPhone),
      commercialEmail: c.commercialEmail ?? '',
      cep: formatCep(c.cep),
      state: c.state ?? '',
      city: c.city ?? '',
      district: c.district ?? '',
      street: c.street ?? '',
      number: c.number ?? '',
      complement: c.complement ?? '',
      notes: c.notes ?? '',
      status: c.status,
      salesRepId: c.salesRepId ?? '',
      availableToAllReps: c.availableToAllReps,
    });
  }, [existing.data]);

  // verificação de duplicidade em tempo real
  const dCnpj = useDebounced(f.cnpj, 400);
  const dName = useDebounced(f.legalName, 600);
  const dup = useQuery({
    queryKey: ['client-dup', dCnpj, dName, id],
    queryFn: () => api<{ cnpjDuplicate: any; similarNames: any[] }>('/admin/clients/check-duplicate', { body: { cnpj: dCnpj, legalName: dName, excludeId: id } }),
    enabled: onlyDigits(dCnpj).length >= 11 || dName.length >= 4,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, state: f.state || null, salesRepId: f.salesRepId || null };
      return isNew ? api('/admin/clients', { body }) : api(`/admin/clients/${id}`, { method: 'PUT', body });
    },
    onSuccess: (c: any) => {
      toast.success(isNew ? 'Cliente cadastrado.' : 'Cliente atualizado.');
      void qc.invalidateQueries({ queryKey: ['clients'] });
      void qc.invalidateQueries({ queryKey: ['client', id] });
      if (isNew) nav(`/admin/clientes/${c.id}`, { replace: true });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });

  const lookupCep = async () => {
    const cep = onlyDigits(f.cep);
    if (cep.length !== 8) return toast.error('Informe um CEP com 8 dígitos.');
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json());
      if (r.erro) return toast.error('CEP não encontrado.');
      setF((p) => ({ ...p, street: r.logradouro || p.street, district: r.bairro || p.district, city: r.localidade || p.city, state: r.uf || p.state }));
      toast.success('Endereço preenchido pelo CEP. Confira os dados.');
    } catch {
      toast.error('Não foi possível consultar o CEP agora. Preencha manualmente.');
    }
  };

  const applyImport = (d: ParsedClient) => {
    setF((p) => {
      const n = { ...p };
      for (const [k, v] of Object.entries(d)) if (v && k in n) (n as any)[k] = v;
      return n;
    });
    setImportOpen(false);
    toast.success('Dados importados. Revise todos os campos antes de salvar.');
  };

  if (!isNew && existing.isLoading) return <Loading />;
  const cnpjInvalid = f.cnpj.length >= 14 && !isValidCnpj(f.cnpj);
  const err = (k: string) => errors[k];

  return (
    <>
      <PageHeader
        back="/admin/clientes"
        title={isNew ? 'Novo cliente' : f.legalName || 'Cliente'}
        subtitle={isNew ? 'Cadastre os dados recebidos do vendedor' : <span className="inline-flex items-center gap-2">Status: <ClientStatusBadge status={existing.data?.status} /></span>}
        actions={
          <>
            <Button variant="secondary" icon={<ClipboardPaste className="size-4" />} onClick={() => setImportOpen(true)}>
              Importar texto do WhatsApp
            </Button>
            <Button icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>
              Salvar cliente
            </Button>
          </>
        }
      />

      {dup.data?.cnpjDuplicate && (
        <div className="mb-4">
          <Alert tone="red" title="CNPJ já cadastrado">
            Este CNPJ pertence a <a className="underline" href={`/admin/clientes/${dup.data.cnpjDuplicate.id}`}>{dup.data.cnpjDuplicate.legalName}</a>. Não é permitido cadastrar o mesmo cliente duas vezes.
          </Alert>
        </div>
      )}
      {!dup.data?.cnpjDuplicate && !!dup.data?.similarNames.length && (
        <div className="mb-4">
          <Alert tone="amber" title="Possível duplicidade">
            Clientes com nome parecido: {dup.data.similarNames.map((s) => `${s.legalName} (${formatCnpj(s.cnpj)})`).join('; ')}.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardTitle>Dados da empresa</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Razão social" required error={err('legalName')} className="sm:col-span-2">
                <Input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} invalid={!!err('legalName')} />
              </Field>
              <Field label="Nome fantasia" error={err('tradeName')}>
                <Input value={f.tradeName} onChange={(e) => set('tradeName', e.target.value)} />
              </Field>
              <Field label="CNPJ" required error={err('cnpj') ?? (cnpjInvalid ? 'CNPJ inválido. Confira os dígitos.' : undefined)} hint="Aceita o formato numérico e o novo alfanumérico.">
                <MaskedInput value={f.cnpj} mask={formatCnpj} inputMode="text" onChange={(v) => set('cnpj', v)} placeholder="00.000.000/0000-00" invalid={cnpjInvalid || !!err('cnpj')} />
              </Field>
              <Field label="Inscrição estadual" error={err('stateRegistration')} hint="Quando aplicável (ou “Isento”)">
                <Input value={f.stateRegistration} onChange={(e) => set('stateRegistration', e.target.value)} />
              </Field>
              <Field label="Nome do responsável" error={err('responsibleName')}>
                <Input value={f.responsibleName} onChange={(e) => set('responsibleName', e.target.value)} />
              </Field>
            </div>
          </Card>
          <Card>
            <CardTitle>Contatos</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="E-mail comercial" error={err('commercialEmail')}>
                <Input type="email" value={f.commercialEmail} onChange={(e) => set('commercialEmail', e.target.value)} />
              </Field>
              <Field label="Telefone comercial" error={err('commercialPhone')}>
                <MaskedInput value={f.commercialPhone} mask={formatPhone} onChange={(v) => set('commercialPhone', v)} placeholder="(00) 00000-0000" />
              </Field>
              <Field label="E-mail do financeiro" error={err('financeEmail')}>
                <Input type="email" value={f.financeEmail} onChange={(e) => set('financeEmail', e.target.value)} />
              </Field>
              <Field label="Telefone do financeiro" error={err('financePhone')}>
                <MaskedInput value={f.financePhone} mask={formatPhone} onChange={(v) => set('financePhone', v)} placeholder="(00) 0000-0000" />
              </Field>
            </div>
          </Card>
          <Card>
            <CardTitle icon={<MapPin className="size-4" />}>Endereço</CardTitle>
            <div className="grid gap-4 sm:grid-cols-6">
              <Field label="CEP" error={err('cep')} className="sm:col-span-2">
                <div className="flex gap-2">
                  <MaskedInput value={f.cep} mask={formatCep} onChange={(v) => set('cep', v)} placeholder="00000-000" />
                  <Button variant="secondary" onClick={lookupCep} aria-label="Buscar CEP" icon={<Wand2 className="size-4" />} />
                </div>
              </Field>
              <Field label="Estado" error={err('state')} className="sm:col-span-1">
                <Select value={f.state} onChange={(e) => set('state', e.target.value)}>
                  <option value="">UF</option>
                  {UFS.map((u) => <option key={u}>{u}</option>)}
                </Select>
              </Field>
              <Field label="Cidade" error={err('city')} className="sm:col-span-3">
                <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="Endereço" error={err('street')} className="sm:col-span-4">
                <Input value={f.street} onChange={(e) => set('street', e.target.value)} />
              </Field>
              <Field label="Número" error={err('number')} className="sm:col-span-2">
                <Input value={f.number} onChange={(e) => set('number', e.target.value)} />
              </Field>
              <Field label="Bairro" error={err('district')} className="sm:col-span-3">
                <Input value={f.district} onChange={(e) => set('district', e.target.value)} />
              </Field>
              <Field label="Complemento" error={err('complement')} className="sm:col-span-3">
                <Input value={f.complement} onChange={(e) => set('complement', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Liberação comercial</CardTitle>
            <div className="space-y-4">
              <Field label="Status do cadastro" error={err('status')}>
                <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
                  {Object.entries(CLIENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Vendedor responsável" error={err('salesRepId')}>
                <Select value={f.salesRepId} onChange={(e) => set('salesRepId', e.target.value)}>
                  <option value="">— Nenhum —</option>
                  {reps.data?.map((r) => <option key={r.id} value={r.id}>{r.fullName}{!r.active ? ' (inativo)' : ''}</option>)}
                </Select>
              </Field>
              <Toggle checked={f.availableToAllReps} onChange={(v) => set('availableToAllReps', v)} label="Liberar para todos os vendedores" description="Qualquer representante ativo poderá atender este cliente." />
              {f.status === 'ACTIVE' ? (
                <Alert tone="green" icon={<AlertTriangle className="size-4" />}>Cliente ativo: disponível para pedidos e orçamentos do vendedor autorizado.</Alert>
              ) : (
                <Alert tone="amber">Enquanto não estiver “Ativo”, o vendedor não consegue selecionar este cliente.</Alert>
              )}
            </div>
          </Card>
          <Card>
            <CardTitle>Observações comerciais</CardTitle>
            <Textarea rows={5} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ex.: condições negociadas, horário de recebimento…" />
          </Card>
          {!isNew && existing.data && (
            <Card>
              <CardTitle icon={<History className="size-4" />}>Rastreabilidade</CardTitle>
              <KeyValue
                cols={1}
                items={[
                  ['Cadastrado em', `${formatDateTimeBR(existing.data.createdAt)}${existing.data.createdByName ? ` por ${existing.data.createdByName}` : ''}`],
                  ['Última alteração', `${formatDateTimeBR(existing.data.updatedAt)}${existing.data.updatedByName ? ` por ${existing.data.updatedByName}` : ''}`],
                  ['Pedidos', `${existing.data.stats.orders} • ${formatBRL(existing.data.stats.totalCents)}`],
                  ['Último pedido', existing.data.stats.lastOrderDate ? formatDateBR(existing.data.stats.lastOrderDate) : 'Nenhum'],
                ]}
              />
              <a href={`/admin/auditoria?entity=client&entityId=${id}`} className="mt-3 inline-block text-sm text-navy-700 hover:underline">
                Ver histórico de alterações
              </a>
            </Card>
          )}
        </div>
      </div>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onApply={applyImport} />
    </>
  );
}

const FIELD_LABELS: Record<string, string> = {
  legalName: 'Razão social',
  tradeName: 'Nome fantasia',
  cnpj: 'CNPJ',
  stateRegistration: 'Inscrição estadual',
  responsibleName: 'Responsável',
  financeEmail: 'E-mail financeiro',
  financePhone: 'Telefone financeiro',
  commercialPhone: 'Telefone comercial',
  commercialEmail: 'E-mail comercial',
  cep: 'CEP',
  state: 'Estado',
  city: 'Cidade',
  district: 'Bairro',
  street: 'Endereço',
  number: 'Número',
  complement: 'Complemento',
  notes: 'Observações',
};

function ImportModal({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (d: ParsedClient) => void }) {
  const [text, setText] = useState('');
  const parsed = text.trim() ? parseClientText(text) : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Importar dados recebidos pelo WhatsApp"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button disabled={!parsed || !Object.keys(parsed.data).length} onClick={() => parsed && onApply(parsed.data)}>Preencher formulário</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">Cole a mensagem com os dados do cliente. O sistema identifica os campos automaticamente; você revisa tudo antes de salvar.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Razão social: Exemplo Ltda\nCNPJ: 00.000.000/0000-00\nResponsável: Fulano\nE-mail financeiro: financeiro@exemplo.com\nTelefone: (11) 99999-9999\nCEP: 00000-000\nEndereço: Rua Exemplo, 100\nCidade: São Paulo/SP'} />
        <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Campos identificados</p>
          {parsed && Object.keys(parsed.data).length ? (
            <dl className="space-y-1.5">
              {Object.entries(parsed.data).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-36 shrink-0 text-muted">{FIELD_LABELS[k] ?? k}</dt>
                  <dd className="min-w-0 break-words font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted">Nada identificado ainda.</p>
          )}
          {!!parsed?.unrecognized.length && (
            <div className="mt-3 border-t border-line pt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Não reconhecido (confira manualmente)</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted">{parsed.unrecognized.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
