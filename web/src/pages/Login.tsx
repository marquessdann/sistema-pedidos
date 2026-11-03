import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import { Alert, Button, Field, Input } from '../components/ui';
import { Brand } from '../components/layout/AppShell';

export function LoginPage() {
  const { me, login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me) return <Navigate to={me.user.mustChangePassword ? '/trocar-senha' : '/'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const m = await login(username.trim(), password);
      nav(m.user.mustChangePassword ? '/trocar-senha' : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-navy-900 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(201,165,90,0.18),transparent_45%),radial-gradient(circle_at_80%_90%,rgba(82,105,156,0.35),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Brand className="w-64" />
          <div className="max-w-md">
            <div className="mb-6 h-0.5 w-14 bg-gold-400" />
            <h1 className="text-4xl font-semibold leading-tight text-white">Pedidos, orçamentos e clientes em um só lugar.</h1>
            <p className="mt-4 text-navy-200">Sistema comercial da Della Distribuidora para administração, gestão e representantes. Valores calculados com segurança no servidor e documentos prontos para o cliente.</p>
          </div>
          <div className="text-xs leading-relaxed text-navy-300">
            <p>Criado e Desenvolvido por Daniel Marques</p>
            <p>© {new Date().getFullYear()} Todos os direitos reservados - Gestão Equipe Della</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center bg-canvas px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center">
            <img src="/brand/della-logo.webp" alt="Della Distribuidora de Produtos" className="h-auto w-56 sm:w-64" />
          </div>
          <h2 className="text-2xl font-semibold text-navy-900">Entrar</h2>
          <p className="mt-1 text-sm text-muted">Use o usuário e a senha fornecidos pela administração.</p>
          <form onSubmit={submit} className="mt-8 space-y-5">
            {error && <Alert tone="red">{error}</Alert>}
            <Field label="Usuário">
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input autoFocus autoComplete="username" className="pl-9" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </div>
            </Field>
            <Field label="Senha">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input type={show ? 'text' : 'password'} autoComplete="current-password" className="px-9" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={loading}>
              Entrar
            </Button>
          </form>
          <div className="mt-10 text-center text-xs leading-relaxed text-muted lg:hidden">
            <p>Criado e Desenvolvido por Daniel Marques</p>
            <p>© {new Date().getFullYear()} Todos os direitos reservados - Gestão Equipe Della</p>
          </div>
        </div>
      </div>
    </div>
  );
}
