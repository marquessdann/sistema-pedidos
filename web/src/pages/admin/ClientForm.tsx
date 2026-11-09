import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, BadgeCheck, ClipboardPaste, History, Loader2, MapPin, Save, Search, Wand2 } from 'lucide-react';
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
  normalizeCnpj,
} from '@della/shared';
import { ApiError, api, errorMessage, fieldErrors } from '../../lib/api';
import { queueClient, workingOffline } from '../../lib/offline';
import { useRole } from '../../lib/auth';
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

/**
 * Cadastro de cliente para os três perfis:
 * - administrador: formulário completo;
 * - gestor: somente para os vendedores que acompanha (status só com permissão de liberar);
 * - vendedor (seller): sem status/vendedor — o cadastro vai para "Pendência cadastral" e serve só para orçamento até a aprovação.
 */
export default function ClientForm({ seller = false }: { seller?: boolean }) {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const { isAdmin, isManager, can } = useRole();
  const base = seller ? '/seller/clients' : '/admin/clients';
  const listPath = seller ? '/vendedor' : '/admin/clientes';
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  const reps = useQuery({ queryKey: ['reps'], queryFn: () => api<{ id: string; fullName: string; active: boolean }[]>('/admin/reps'), enabled: !seller });
  const existing = useQuery({ queryKey: ['client', base, id], queryFn: () => api<any>(`${base}/${id}`), enabled: !isNew });

  // gestor que acompanha um único vendedor já começa com ele selecionado
  useEffect(() => {
    if (isNew && isManager && reps.data?.length === 1) setF((p) => ({ ...p, salesRepId: p.salesRepId || reps.data![0].id, status: can('canReleaseClients') ? 'ACTIVE' : 'UNDER_REVIEW' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reps.data, isNew, isManager]);

  useEffect(() => {
    const raw = existing.data;
    if (!raw) return;
    // o endpoint do vendedor devolve o endereço agrupado
    const c = seller ? { ...raw, ...raw.address, ...raw.raw } : raw;
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
    enabled: !seller && (onlyDigits(dCnpj).length >= 11 || dName.length >= 4),
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...f, state: f.state || null, salesRepId: f.salesRepId || null };
      if (seller) {
        delete body.status;
        delete body.salesRepId;
        delete body.availableToAllReps;
      }
      if (seller && isNew) {
        // vendedor sem internet: o cadastro fica guardado no aparelho e já pode receber orçamento
        if (workingOffline()) return queueClient(body);
        return api(base, { body }).catch((e) => (e instanceof ApiError && e.status === 0 ? queueClient(body) : Promise.reject(e)));
      }
      return isNew ? api(base, { body }) : api(`${base}/${id}`, { method: 'PUT', body });
    },
    onSuccess: (c: any) => {
      void qc.invalidateQueries();
      if (seller) {
        toast.success(
          c?.offline
            ? 'Cliente guardado no celular. Já dá para fazer orçamento; o cadastro é enviado sozinho quando a internet voltar.'
            : isNew
              ? 'Cadastro enviado para aprovação. Você já pode fazer orçamentos para este cliente.'
              : 'Correção enviada para aprovação.',
          c?.offline ? { duration: 7000 } : undefined,
        );
        try {
          sessionStorage.setItem('della:selected-client', JSON.stringify(c.id ?? id));
        } catch {
          /* ignore */
        }
        nav('/vendedor', { replace: true });
        return;
      }
      toast.success(isNew ? 'Cliente cadastrado.' : 'Cliente atualizado.');
      if (isNew) nav(`/admin/clientes/${c.id}`, { replace: true });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });

  // consulta automática na Receita Federal ao digitar um CNPJ válido
  const [receita, setReceita] = useState<null | { status: string | null; statusOk: boolean; source: string; mainActivity: string | null }>(null);
  const [receitaState, setReceitaState] = useState<'idle' | 'loading' | 'notfound' | 'error'>('idle');
  const lastLookup = useRef('');
  const lookupCnpj = async (force = false) => {
    const digits = normalizeCnpj(f.cnpj);
    if (!isValidCnpj(digits) || (!force && lastLookup.current === digits)) return;
    if (!force && workingOffline()) return;
    lastLookup.current = digits;
    setReceitaState('loading');
    try {
      const d = await api<any>(`/cnpj/${digits}`);
      setReceita({ status: d.status, statusOk: d.statusOk, source: d.source, mainActivity: d.mainActivity });
      setReceitaState('idle');
      // preenche somente o que ainda está em branco (não apaga o que já foi digitado)
      setF((p) => {
        const fill = <K extends keyof Form>(k: K, v: Form[K] | null | undefined) => (!p[k] && v ? v : p[k]);
        return {
          ...p,
          legalName: fill('legalName', d.legalName),
          tradeName: fill('tradeName', d.tradeName),
          commercialPhone: fill('commercialPhone', d.phone ? formatPhone(d.phone) : null),
          commercialEmail: fill('commercialEmail', d.email),
          cep: fill('cep', d.cep ? formatCep(d.cep) : null),
          state: fill('state', d.state),
          city: fill('city', d.city),
          district: fill('district', d.district),
          street: fill('street', d.street),
          number: fill('number', d.number),
          complement: fill('complement', d.complement),
        };
      });
      toast.success('Dados da Receita Federal preenchidos. A Inscrição Estadual precisa ser digitada.');
    } catch (e) {
      setReceita(null);
      setReceitaState(e instanceof ApiError && e.status === 404 ? 'notfound' : 'error');
    }
  };
  useEffect(() => {
    if (isNew && isValidCnpj(dCnpj)) void lookupCnpj();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dCnpj, isNew]);

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
        back={listPath}
        title={isNew ? (seller ? 'Cadastrar cliente' : 'Novo cliente') : f.legalName || 'Cliente'}
        subtitle={
          isNew
            ? seller
              ? 'O cadastro vai para aprovação. Enquanto isso, você já pode fazer orçamentos para ele.'
              : 'Cadastre os dados do cliente'
            : <span className="inline-flex items-center gap-2">Status: <ClientStatusBadge status={existing.data?.status} /></span>
        }
        actions={
          <>
            <Button variant="secondary" icon={<ClipboardPaste className="size-4" />} onClick={() => setImportOpen(true)}>
              Importar texto do WhatsApp
            </Button>
            <Button icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>
              {seller ? 'Enviar para aprovação' : 'Salvar cliente'}
            </Button>
          </>
        }
      />

      {dup.data?.cnpjDuplicate && (
        <div className="mb-4">
          <Alert tone="red" title="CNPJ já cadastrado">
            Este CNPJ pertence a {dup.data.cnpjDuplicate.id ? <a className="underline" href={`/admin/clientes/${dup.data.cnpjDuplicate.id}`}>{dup.data.cnpjDuplicate.legalName}</a> : dup.data.cnpjDuplicate.legalName}. Não é permitido cadastrar o mesmo cliente duas vezes.
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
                <div className="flex gap-2">
                  <MaskedInput value={f.cnpj} mask={formatCnpj} inputMode="text" onChange={(v) => set('cnpj', v)} placeholder="00.000.000/0000-00" invalid={cnpjInvalid || !!err('cnpj')} />
                  <Button variant="secondary" aria-label="Buscar dados na Receita Federal" title="Buscar dados na Receita Federal" disabled={!isValidCnpj(f.cnpj) || receitaState === 'loading'} onClick={() => void lookupCnpj(true)} icon={receitaState === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} />
                </div>
                {receitaState === 'loading' && <p className="mt-1 text-xs text-muted">Consultando a Receita Federal…</p>}
                {receitaState === 'notfound' && <p className="mt-1 text-xs text-amber-700">CNPJ não encontrado na Receita. Confira o número ou preencha manualmente.</p>}
                {seller && isNew && (receitaState === 'error' || workingOffline()) ? (
                  <p className="mt-1 text-xs text-amber-800">
                    <strong>Sem internet:</strong> pode salvar só com o CNPJ. Razão social, endereço e contato são preenchidos sozinhos quando a internet voltar.
                  </p>
                ) : (
                  receitaState === 'error' && <p className="mt-1 text-xs text-amber-700">Consulta à Receita indisponível agora (sem internet?). Preencha manualmente.</p>
                )}
                {receita && receitaState === 'idle' && (
                  receita.statusOk ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700"><BadgeCheck className="size-3.5" /> CNPJ ativo na Receita Federal{receita.mainActivity ? ` • ${receita.mainActivity}` : ''}</p>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600"><AlertTriangle className="size-3.5" /> Situação na Receita: {receita.status ?? 'desconhecida'} — confira antes de cadastrar.</p>
                  )
                )}
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
          {seller ? (
            <Card>
              <CardTitle>Aprovação</CardTitle>
              {existing.data?.reviewNote && (
                <div className="mb-3">
                  <Alert tone="amber" title="Pedido de correção">{existing.data.reviewNote}</Alert>
                </div>
              )}
              <p className="text-sm text-muted">
                Ao enviar, o cadastro aparece em <strong>Pendência cadastral</strong> para o administrador e o gestor. Enquanto aguarda, este cliente fica disponível
                <strong> só para orçamentos</strong>. Depois da aprovação, você poderá fazer pedidos e transformar os orçamentos em pedido.
              </p>
            </Card>
          ) : (
          <Card>
            <CardTitle>Liberação comercial</CardTitle>
            <div className="space-y-4">
              {(isAdmin || can('canReleaseClients')) && (
              <Field label="Status do cadastro" error={err('status')}>
                <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
                  {Object.entries(CLIENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              )}
              <Field label="Vendedor responsável" error={err('salesRepId')}>
                <Select value={f.salesRepId} onChange={(e) => set('salesRepId', e.target.value)}>
                  <option value="">— Nenhum —</option>
                  {reps.data?.map((r) => <option key={r.id} value={r.id}>{r.fullName}{!r.active ? ' (inativo)' : ''}</option>)}
                </Select>
              </Field>
              {isAdmin && <Toggle checked={f.availableToAllReps} onChange={(v) => set('availableToAllReps', v)} label="Liberar para todos os vendedores" description="Qualquer representante ativo poderá atender este cliente." />}
              {f.status === 'ACTIVE' ? (
                <Alert tone="green" icon={<AlertTriangle className="size-4" />}>Cliente ativo: disponível para pedidos e orçamentos do vendedor autorizado.</Alert>
              ) : (
                <Alert tone="amber">Enquanto não estiver “Ativo”, o vendedor só consegue fazer orçamentos (se o cadastro estiver em análise) e não faz pedidos.</Alert>
              )}
            </div>
          </Card>
          )}
          <Card>
            <CardTitle>Observações comerciais</CardTitle>
            <Textarea rows={5} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ex.: condições negociadas, horário de recebimento…" />
          </Card>
          {!isNew && !seller && existing.data?.stats && (
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
              {isAdmin && (
                <a href={`/admin/auditoria?entity=client&entityId=${id}`} className="mt-3 inline-block text-sm text-navy-700 hover:underline">
                  Ver histórico de alterações
                </a>
              )}
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
