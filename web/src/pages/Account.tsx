import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../lib/api';
import { useAuth, type Me } from '../lib/auth';
import { Alert, Button, Card, CardTitle, Field, Input, KeyValue, PageHeader } from '../components/ui';
import { Brand } from '../components/layout/AppShell';
import { formatBps, formatPhone } from '@della/shared';

function PasswordForm({ onDone, forced }: { onDone: () => void; forced?: boolean }) {
  const { setMe } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (newPassword !== confirm) return setErrors({ confirm: 'As senhas não conferem.' });
    setLoading(true);
    try {
      const me = await api<Me>('/auth/change-password', { body: { currentPassword, newPassword } });
      setMe(me);
      toast.success('Senha alterada com sucesso.');
      onDone();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(Object.keys(fe).length ? fe : { form: errorMessage(err) });
    } finally {
      setLoading(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      {errors.form && <Alert tone="red">{errors.form}</Alert>}
      <Field label={forced ? 'Senha atual (inicial)' : 'Senha atual'} error={errors.currentPassword}>
        <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="Nova senha" error={errors.newPassword} hint="Mínimo de 8 caracteres, com letras e números. Não use seu nome de usuário.">
        <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} required />
      </Field>
      <Field label="Confirme a nova senha" error={errors.confirm}>
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <Button type="submit" loading={loading} className="w-full" size="lg">
        Salvar nova senha
      </Button>
    </form>
  );
}

export function ChangePasswordPage() {
  const { me, loading, logout } = useAuth();
  const nav = useNavigate();
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (!me.user.mustChangePassword) return <Navigate to="/" replace />;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <Card className="p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-50 text-gold-600">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-navy-900">Olá, {me.user.name.split(' ')[0]}! Crie sua senha</h1>
              <p className="text-sm text-muted">Por segurança, a senha inicial precisa ser trocada no primeiro acesso.</p>
            </div>
          </div>
          <PasswordForm forced onDone={() => nav('/', { replace: true })} />
          <button className="mt-4 w-full text-center text-sm text-muted hover:text-navy-800" onClick={() => logout().then(() => nav('/login'))}>
            Sair
          </button>
        </Card>
      </div>
    </div>
  );
}

export function AccountPage() {
  const { me } = useAuth();
  return (
    <>
      <PageHeader title="Minha conta" subtitle="Dados de acesso e segurança" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Dados do usuário</CardTitle>
          <KeyValue
            items={[
              ['Nome', me?.rep?.fullName ?? me?.user.name],
              ['Usuário', me?.user.username],
              ['Perfil', me?.user.role === 'ADMIN' ? 'Administrador (acesso total)' : me?.user.role === 'MANAGER' ? 'Gestor' : me?.rep?.title],
              ...(me?.rep
                ? ([
                    ['Telefone', me.rep.phone ? formatPhone(me.rep.phone) : null],
                    ['Desconto máximo permitido', formatBps(me.rep.maxDiscountBps)],
                  ] as [string, string | null][])
                : []),
            ]}
          />
        </Card>
        <Card>
          <CardTitle icon={<KeyRound className="size-4" />}>Alterar senha</CardTitle>
          <PasswordForm onDone={() => undefined} />
        </Card>
      </div>
    </>
  );
}
