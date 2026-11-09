import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, useRole, type ManagerPerms } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { Loading } from './components/ui';
import { LoginPage } from './pages/Login';
import { ChangePasswordPage, AccountPage } from './pages/Account';

const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Clients = lazy(() => import('./pages/admin/Clients'));
const ClientForm = lazy(() => import('./pages/admin/ClientForm'));
const Products = lazy(() => import('./pages/admin/Products'));
const ProductForm = lazy(() => import('./pages/admin/ProductForm'));
const Brands = lazy(() => import('./pages/admin/Brands'));
const Reps = lazy(() => import('./pages/admin/Reps'));
const RepForm = lazy(() => import('./pages/admin/RepForm'));
const AdminOrders = lazy(() => import('./pages/admin/Orders'));
const AdminOrderDetail = lazy(() => import('./pages/admin/OrderDetail'));
const AdminQuotes = lazy(() => import('./pages/admin/Quotes'));
const AdminQuoteDetail = lazy(() => import('./pages/admin/QuoteDetail'));
const Approvals = lazy(() => import('./pages/admin/Approvals'));
const Stock = lazy(() => import('./pages/admin/Stock'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Audit = lazy(() => import('./pages/admin/Audit'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const Commissions = lazy(() => import('./pages/admin/Commissions'));
const Pending = lazy(() => import('./pages/admin/Pending'));

const SellerHome = lazy(() => import('./pages/seller/Home'));
const DocWizard = lazy(() => import('./pages/seller/DocWizard'));
const SellerOrders = lazy(() => import('./pages/seller/Orders'));
const SellerOrderView = lazy(() => import('./pages/seller/OrderView'));
const OrderProcess = lazy(() => import('./pages/seller/OrderProcess'));
const SellerQuotes = lazy(() => import('./pages/seller/Quotes'));
const SellerQuoteView = lazy(() => import('./pages/seller/QuoteView'));
const Catalog = lazy(() => import('./pages/seller/Catalog'));
const SyncPage = lazy(() => import('./pages/seller/Sync'));
const LogisticsList = lazy(() => import('./pages/logistics/Logistics').then((m) => ({ default: m.LogisticsList })));
const LogisticsOrder = lazy(() => import('./pages/logistics/Logistics').then((m) => ({ default: m.LogisticsOrder })));

const homeOf = (role: string) => (role === 'SELLER' ? '/vendedor' : role === 'LOGISTICS' ? '/logistica' : '/admin');

function RequireRole({ role, children }: { role?: ('ADMIN' | 'MANAGER' | 'SELLER' | 'LOGISTICS')[]; children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (me.user.mustChangePassword) return <Navigate to="/trocar-senha" replace />;
  if (role && !role.includes(me.user.role)) return <Navigate to={homeOf(me.user.role)} replace />;
  return <>{children}</>;
}

/** Telas exclusivas do administrador total (Daniel). */
function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useRole();
  return isAdmin ? <>{children}</> : <Navigate to="/admin" replace />;
}

/** Telas do gestor que dependem de uma permissão (o administrador total sempre acessa). */
function Allow({ perm, children }: { perm: keyof ManagerPerms; children: ReactNode }) {
  const { can } = useRole();
  return can(perm) ? <>{children}</> : <Navigate to="/admin" replace />;
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={homeOf(me.user.role)} replace />;
}

function AdminHome() {
  const { isAdmin, can } = useRole();
  if (isAdmin || can('canViewSales')) return <Dashboard />;
  if (can('canViewCommissions')) return <Navigate to="/admin/comissoes" replace />;
  if (can('canReleaseProducts')) return <Navigate to="/admin/produtos" replace />;
  return <Navigate to="/admin/clientes" replace />;
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route path="/" element={<Home />} />
        <Route path="/logistica" element={<RequireRole role={['LOGISTICS']}><LogisticsList /></RequireRole>} />
        <Route path="/logistica/:id" element={<RequireRole role={['LOGISTICS']}><LogisticsOrder /></RequireRole>} />
        <Route
          element={
            <RequireRole>
              <AppShell />
            </RequireRole>
          }
        >
          <Route path="/conta" element={<AccountPage />} />
        </Route>
        <Route
          path="/admin"
          element={
            <RequireRole role={['ADMIN', 'MANAGER']}>
              <AppShell />
            </RequireRole>
          }
        >
          <Route index element={<AdminHome />} />
          <Route path="clientes" element={<Clients />} />
          <Route path="clientes/novo" element={<ClientForm />} />
          <Route path="clientes/:id" element={<ClientForm />} />
          <Route path="pendencias" element={<Allow perm="canReleaseClients"><Pending /></Allow>} />
          <Route path="produtos" element={<Allow perm="canReleaseProducts"><Products /></Allow>} />
          <Route path="produtos/novo" element={<AdminOnly><ProductForm /></AdminOnly>} />
          <Route path="produtos/:id" element={<AdminOnly><ProductForm /></AdminOnly>} />
          <Route path="marcas" element={<AdminOnly><Brands /></AdminOnly>} />
          <Route path="vendedores" element={<AdminOnly><Reps /></AdminOnly>} />
          <Route path="vendedores/novo" element={<AdminOnly><RepForm /></AdminOnly>} />
          <Route path="vendedores/:id" element={<AdminOnly><RepForm /></AdminOnly>} />
          <Route path="pedidos" element={<Allow perm="canViewSales"><AdminOrders /></Allow>} />
          <Route path="pedidos/:id" element={<Allow perm="canViewSales"><AdminOrderDetail /></Allow>} />
          <Route path="orcamentos" element={<Allow perm="canViewSales"><AdminQuotes /></Allow>} />
          <Route path="orcamentos/:id" element={<Allow perm="canViewSales"><AdminQuoteDetail /></Allow>} />
          <Route path="comissoes" element={<Allow perm="canViewCommissions"><Commissions /></Allow>} />
          <Route path="aprovacoes" element={<Allow perm="canApproveDiscounts"><Approvals /></Allow>} />
          <Route path="estoque" element={<AdminOnly><Stock /></AdminOnly>} />
          <Route path="relatorios" element={<AdminOnly><Reports /></AdminOnly>} />
          <Route path="auditoria" element={<AdminOnly><Audit /></AdminOnly>} />
          <Route path="configuracoes" element={<AdminOnly><Settings /></AdminOnly>} />
        </Route>
        <Route
          path="/vendedor"
          element={
            <RequireRole role={['SELLER']}>
              <AppShell />
            </RequireRole>
          }
        >
          <Route index element={<SellerHome />} />
          <Route path="novo-pedido" element={<DocWizard mode="order" />} />
          <Route path="pedidos/:id/editar" element={<DocWizard mode="order" />} />
          <Route path="novo-orcamento" element={<DocWizard mode="quote" />} />
          <Route path="orcamentos/:id/editar" element={<DocWizard mode="quote" />} />
          <Route path="sincronizar" element={<SyncPage />} />
          <Route path="pedidos" element={<SellerOrders />} />
          <Route path="pedidos/:id" element={<SellerOrderView />} />
          <Route path="processo" element={<OrderProcess />} />
          <Route path="orcamentos" element={<SellerQuotes />} />
          <Route path="orcamentos/:id" element={<SellerQuoteView />} />
          <Route path="catalogo" element={<Catalog />} />
          <Route path="clientes/novo" element={<ClientForm seller />} />
          <Route path="clientes/:id/editar" element={<ClientForm seller />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </Suspense>
  );
}
