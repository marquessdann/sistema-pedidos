import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Calculator,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  MoreHorizontal,
  FileText,
  Home,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Package,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Tags,
  UserCheck,
  UserCog,
  Users,
  Warehouse,
  X,
} from 'lucide-react';
import { useAuth, useRole } from '../../lib/auth';
import { api } from '../../lib/api';
import { cx } from '../ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  end?: boolean;
  /** rótulo curto para o menu inferior do celular */
  short?: string;
}

/** Logotipo oficial da Della. "chip" = sobre fundo escuro (cartão branco); "plain" = sobre fundo claro. */
export function Brand({ variant = 'chip', className }: { variant?: 'chip' | 'plain'; className?: string }) {
  const img = <img src="/brand/della-horizontal.webp" alt="Della Distribuidora de Produtos" className={cx('h-auto w-full', variant === 'plain' && className)} draggable={false} />;
  if (variant === 'plain') return img;
  return <div className={cx('rounded-xl bg-white px-3 py-2.5 shadow-sm', className)}>{img}</div>;
}

export function AppShell() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const { isManager, can } = useRole();
  // painel de gestão (administrador total ou gestor)
  const isAdmin = me?.user.role === 'ADMIN' || isManager;

  useEffect(() => setOpen(false), [loc.pathname]);

  const pendingClients = useQuery({
    queryKey: ['clients-pending'],
    queryFn: () => api<{ total: number }>('/admin/clients-pending'),
    enabled: can('canReleaseClients'),
    refetchInterval: 60_000,
  });
  const pending = useQuery({
    queryKey: ['approvals-count'],
    queryFn: () => api<{ total: number }>('/admin/approvals', { query: { status: 'PENDING', pageSize: 1 } }),
    enabled: can('canApproveDiscounts'),
    refetchInterval: 60_000,
  });

  const items: NavItem[] = isManager
    ? ([
        can('canViewSales') && { to: '/admin', label: 'Painel', short: 'Painel', icon: <LayoutDashboard />, end: true },
        can('canViewSales') && { to: '/admin/pedidos', label: 'Vendas', icon: <ClipboardList /> },
        can('canReleaseClients') && { to: '/admin/pendencias', label: 'Pendência cadastral', short: 'Pendências', icon: <UserCheck />, badge: pendingClients.data?.total },
        can('canViewSales') && { to: '/admin/orcamentos', label: 'Orçamentos', icon: <FileText /> },
        can('canViewCommissions') && { to: '/admin/comissoes', label: 'Comissões', icon: <Calculator /> },
        can('canApproveDiscounts') && { to: '/admin/aprovacoes', label: 'Aprovações', icon: <ClipboardCheck />, badge: pending.data?.total },
        can('canReleaseProducts') && { to: '/admin/produtos', label: 'Liberar produtos', short: 'Produtos', icon: <Package /> },
        { to: '/admin/clientes', label: 'Clientes', icon: <Users /> },
      ].filter(Boolean) as NavItem[])
    : isAdmin
    ? [
        { to: '/admin', label: 'Dashboard', short: 'Painel', icon: <LayoutDashboard />, end: true },
        { to: '/admin/clientes', label: 'Clientes', icon: <Users /> },
        { to: '/admin/pendencias', label: 'Pendência cadastral', short: 'Pendências', icon: <UserCheck />, badge: pendingClients.data?.total },
        { to: '/admin/produtos', label: 'Produtos', icon: <Package /> },
        { to: '/admin/marcas', label: 'Marcas e categorias', icon: <Tags /> },
        { to: '/admin/vendedores', label: 'Vendedores', icon: <UserCog /> },
        { to: '/admin/pedidos', label: 'Pedidos', icon: <ClipboardList /> },
        { to: '/admin/orcamentos', label: 'Orçamentos', icon: <FileText /> },
        { to: '/admin/aprovacoes', label: 'Aprovações', icon: <ClipboardCheck />, badge: pending.data?.total },
        { to: '/admin/comissoes', label: 'Comissões', icon: <Calculator /> },
        { to: '/admin/estoque', label: 'Estoque', icon: <Warehouse /> },
        { to: '/admin/relatorios', label: 'Relatórios', icon: <BarChart3 /> },
        { to: '/admin/auditoria', label: 'Auditoria', icon: <ScrollText /> },
        { to: '/admin/configuracoes', label: 'Configurações', icon: <Settings /> },
      ]
    : [
        { to: '/vendedor', label: 'Início', icon: <Home />, end: true },
        { to: '/vendedor/pedidos', label: 'Meus pedidos', short: 'Pedidos', icon: <ClipboardList /> },
        { to: '/vendedor/processo', label: 'Processo do pedido', short: 'Andamento', icon: <Route /> },
        { to: '/vendedor/orcamentos', label: 'Orçamentos', icon: <FileText /> },
        { to: '/vendedor/catalogo', label: 'Catálogo', icon: <Boxes /> },
      ];

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 text-navy-100">
      <div className="flex items-center justify-between gap-2 px-4 py-4">
        <Brand className="w-full" />
        <button className="rounded p-1 text-navy-200 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
          <X className="size-5" />
        </button>
      </div>
      <div className="mx-5 mb-3 h-px bg-gradient-to-r from-gold-500/60 to-transparent" />
      <p className="px-5 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-navy-300">{isManager ? 'Gestão' : isAdmin ? 'Administração' : 'Representante'}</p>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cx(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors [&_svg]:size-[18px]',
                isActive ? 'bg-white/10 font-medium text-white' : 'text-navy-200 hover:bg-white/5 hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-gold-400" />}
                <span className={isActive ? 'text-gold-400' : 'text-navy-300 group-hover:text-navy-100'}>{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {!!it.badge && <span className="rounded-full bg-gold-500 px-2 py-0.5 text-xs font-semibold text-white">{it.badge}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <NavLink to="/conta" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-navy-200 hover:bg-white/5 hover:text-white">
          <KeyRound className="size-[18px] text-navy-300" /> Minha conta
        </NavLink>
        <button
          onClick={async () => {
            await logout();
            nav('/login');
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-navy-200 hover:bg-white/5 hover:text-white"
        >
          <LogOut className="size-[18px] text-navy-300" /> Sair
        </button>
      </div>
    </div>
  );

  // telas de montagem de pedido/orçamento ocupam a tela inteira no celular (têm barra própria)
  const fullscreenFlow = /\/(novo-pedido|novo-orcamento|editar)(\/|$)/.test(loc.pathname);
  const bottom = isManager
    ? items.slice(0, 4).map((i) => i.to)
    : isAdmin
      ? ['/admin', '/admin/pedidos', '/admin/pendencias', '/admin/clientes']
      : ['/vendedor', '/vendedor/pedidos', '/vendedor/processo', '/vendedor/orcamentos'];
  const bottomItems = bottom.map((to) => items.find((i) => i.to === to)!).filter(Boolean);

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
          <aside className="animate-fadein absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-white/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur lg:px-8">
        <div className="flex items-center gap-3">
          <div className="w-32 lg:hidden">
            <Brand variant="plain" />
          </div>
          <span className="hidden text-sm text-muted lg:inline">{me?.company.name ?? 'Della'} • Sistema comercial</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <p className="max-w-40 truncate text-sm font-medium text-navy-900">{me?.rep?.fullName ?? me?.user.name}</p>
            <p className="text-xs text-muted">{isManager ? 'Gestor' : isAdmin ? 'Administrador' : me?.rep?.title}</p>
          </div>
          <div className="flex size-9 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-gold-300">
            {(me?.user.name ?? '?')
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          {me?.user.role === 'ADMIN' && <ShieldCheck className="hidden size-4 text-gold-500 sm:block" aria-label="Administrador" />}
        </div>
      </header>
      <main className={cx('mx-auto max-w-[1400px] px-4 py-5 lg:px-8 lg:py-8', fullscreenFlow ? 'pb-6' : 'pb-28 lg:pb-8')}>
        <Outlet />
      </main>
      {!fullscreenFlow && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,35,65,0.06)] backdrop-blur lg:hidden"
          aria-label="Menu principal"
        >
          <ul className="mx-auto grid max-w-xl grid-cols-5">
            {bottomItems.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    cx(
                      'relative flex flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 text-[11px] font-medium [&_svg]:size-[22px]',
                      isActive ? 'text-navy-900' : 'text-slate-500',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-gold-500" />}
                      <span className={isActive ? 'text-gold-600' : ''}>{it.icon}</span>
                      <span className="truncate">{it.short ?? it.label}</span>
                      {!!it.badge && <span className="absolute right-3 top-1 rounded-full bg-gold-500 px-1.5 text-[10px] font-semibold text-white">{it.badge}</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
            <li>
              <button onClick={() => setOpen(true)} className="flex w-full flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 text-[11px] font-medium text-slate-500 [&_svg]:size-[22px]">
                <MoreHorizontal />
                Mais
              </button>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
