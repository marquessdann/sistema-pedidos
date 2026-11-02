import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Lock, Power, Save, ShieldCheck } from 'lucide-react';
import { formatCpf, formatDateBR, formatDateTimeBR, formatPhone, isValidCpf } from '@della/shared';
import { api, errorMessage, fieldErrors } from '../../lib/api';
import { Alert, Badge, Button, Card, CardTitle, Field, Input, KeyValue, Loading, MaskedInput, Modal, PageHeader, PercentInput, Textarea, Toggle, useConfirm } from '../../components/ui';

const EMPTY = {
  fullName: '',
  title: 'Representante comercial',
  cpf: '',
  phone: '',
  contactPhone: '',
  email: '',
  username: '',
  password: '',
  commissionBps: null as number | null,
  maxDiscountBps: 0 as number | null,
  canViewAllOrders: false,
  canViewCost: false,
  canViewClientTotals: true,
  canViewFinanceContact: false,
  notes: '',
};

export default function RepForm() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pwdOpen, setPwdOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((p) => ({ ...p, [k]: v }));
  const existing = useQuery({ queryKey: ['rep', id], queryFn: () => api<any>(`/admin/reps/${id}`), enabled: !isNew });

  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setF({
      fullName: r.fullName,
      title: r.title,
      cpf: formatCpf(r.cpf),
      phone: formatPhone(r.phone),
      contactPhone: formatPhone(r.contactPhone),
      email: r.email ?? '',
      username: r.username,
      password: '',
      commissionBps: r.commissionBps,
      maxDiscountBps: r.maxDiscountBps,
      canViewAllOrders: r.canViewAllOrders,
      canViewCost: r.canViewCost,
      canViewClientTotals: r.canViewClientTotals,
      canViewFinanceContact: r.canViewFinanceContact,
      notes: r.notes ?? '',
    });
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const { username, password, ...rest } = f;
      const body = { ...rest, maxDiscountBps: f.maxDiscountBps ?? 0 };
      return isNew ? api('/admin/reps', { body: { ...body, username, password } }) : api(`/admin/reps/${id}`, { method: 'PUT', body });
    },
    onSuccess: (r: any) => {
      toast.success(isNew ? 'Vendedor cadastrado. Ele deverá trocar a senha no primeiro acesso.' : 'Dados salvos.');
      void qc.invalidateQueries({ queryKey: ['reps'] });
      void qc.invalidateQueries({ queryKey: ['rep', id] });
      if (isNew) nav(`/admin/vendedores/${r.id}`, { replace: true });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(errorMessage(e));
    },
  });
  const toggle = useMutation({
    mutationFn: (active: boolean) => api(`/admin/reps/${id}/active`, { body: { active } }),
    onSuccess: () => {
      toast.success('Status atualizado.');
      void qc.invalidateQueries({ queryKey: ['rep', id] });
      void qc.invalidateQueries({ queryKey: ['reps'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api(`/admin/reps/${id}/reset-password`, { body: { password: newPwd } }),
    onSuccess: () => {
      toast.success('Senha redefinida. O vendedor deverá trocá-la no próximo acesso.');
      setPwdOpen(false);
      setNewPwd('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!isNew && existing.isLoading) return <Loading />;
  const r = existing.data;
  const err = (k: string) => errors[k];
  const missing = !isNew && (!f.cpf || !f.phone);

  return (
    <>
      <PageHeader
        back="/admin/vendedores"
        title={isNew ? 'Novo vendedor' : f.fullName}
        subtitle={!isNew && r && <span className="inline-flex items-center gap-2">{r.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="red">Inativo</Badge>} Cadastrado em {formatDateBR(r.createdAt)}</span>}
        actions={
          <>
            {!isNew && r && (
              <>
                <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setPwdOpen(true)}>Redefinir senha</Button>
                <Button
                  variant={r.active ? 'danger' : 'success'}
                  icon={<Power className="size-4" />}
                  loading={toggle.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: r.active ? 'Bloquear vendedor?' : 'Ativar vendedor?',
                      message: r.active ? 'O vendedor perderá o acesso imediatamente (sessões abertas serão encerradas).' : 'O vendedor voltará a acessar o sistema.',
                      tone: r.active ? 'danger' : 'success',
                      confirmLabel: r.active ? 'Bloquear' : 'Ativar',
                    });
                    if (ok) toggle.mutate(!r.active);
                  }}
                >
                  {r.active ? 'Bloquear' : 'Ativar'}
                </Button>
              </>
            )}
            <Button icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </>
        }
      />
      {missing && <div className="mb-4"><Alert tone="amber" title="Cadastro incompleto">Preencha o CPF e o telefone do vendedor.</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardTitle>Dados pessoais</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome completo" required error={err('fullName')}><Input value={f.fullName} onChange={(e) => set('fullName', e.target.value)} /></Field>
              <Field label="Cargo" error={err('title')}><Input value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
              <Field label="CPF" error={err('cpf') ?? (f.cpf.length === 14 && !isValidCpf(f.cpf) ? 'CPF inválido.' : undefined)}>
                <MaskedInput value={f.cpf} mask={formatCpf} onChange={(v) => set('cpf', v)} placeholder="000.000.000-00" />
              </Field>
              <Field label="E-mail" error={err('email')}><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
              <Field label="Telefone" error={err('phone')}><MaskedInput value={f.phone} mask={formatPhone} onChange={(v) => set('phone', v)} placeholder="(00) 00000-0000" /></Field>
              <Field label="Número de contato (WhatsApp)" error={err('contactPhone')} hint="Exibido no PDF para o cliente."><MaskedInput value={f.contactPhone} mask={formatPhone} onChange={(v) => set('contactPhone', v)} placeholder="(00) 00000-0000" /></Field>
            </div>
          </Card>
          <Card>
            <CardTitle>Regras comerciais</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Desconto máximo permitido" required error={err('maxDiscountBps')} hint="Acima disso, o pedido exige aprovação do administrador.">
                <PercentInput value={f.maxDiscountBps} onChange={(v) => set('maxDiscountBps', v)} />
              </Field>
              <Field label="Comissão" error={err('commissionBps')} hint="Opcional.">
                <PercentInput value={f.commissionBps} onChange={(v) => set('commissionBps', v)} />
              </Field>
            </div>
          </Card>
          <Card>
            <CardTitle>Observações</CardTitle>
            <Textarea rows={4} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardTitle icon={<Lock className="size-4" />}>Acesso</CardTitle>
            {isNew ? (
              <div className="space-y-4">
                <Field label="Nome de usuário" required error={err('username')}><Input value={f.username} autoComplete="off" onChange={(e) => set('username', e.target.value.toLowerCase())} /></Field>
                <Field label="Senha inicial" required error={err('password')} hint="Mínimo de 8 caracteres com letras e números. Troca obrigatória no 1º acesso.">
                  <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} />
                </Field>
              </div>
            ) : (
              <KeyValue cols={1} items={[['Usuário', r?.username], ['Último acesso', r?.lastLoginAt ? formatDateTimeBR(r.lastLoginAt) : 'Nunca acessou'], ['Senha', r?.mustChangePassword ? 'Troca pendente no próximo acesso' : 'Definida pelo vendedor']]} />
            )}
          </Card>
          <Card>
            <CardTitle icon={<ShieldCheck className="size-4" />}>Permissões</CardTitle>
            <div className="space-y-4">
              <Toggle checked={f.canViewClientTotals} onChange={(v) => set('canViewClientTotals', v)} label="Ver total de compras do cliente" />
              <Toggle checked={f.canViewFinanceContact} onChange={(v) => set('canViewFinanceContact', v)} label="Ver contato financeiro do cliente" />
              <Toggle checked={f.canViewAllOrders} onChange={(v) => set('canViewAllOrders', v)} label="Consultar pedidos de outros vendedores" description="Somente leitura. Desligado por padrão." />
              <Toggle checked={f.canViewCost} onChange={(v) => set('canViewCost', v)} label="Ver custo e margem no catálogo" description="Informação confidencial. Nunca aparece no PDF do cliente." />
            </div>
          </Card>
        </div>
      </div>
      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="Redefinir senha" size="sm" footer={<><Button variant="secondary" onClick={() => setPwdOpen(false)}>Cancelar</Button><Button loading={reset.isPending} onClick={() => reset.mutate()}>Redefinir</Button></>}>
        <Field label="Nova senha provisória" hint="O vendedor será obrigado a trocar no próximo acesso. Sessões abertas serão encerradas.">
          <Input type="password" autoComplete="new-password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}
