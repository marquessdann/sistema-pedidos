import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
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

const SellerHome = lazy(() => import('./pages/seller/Home'));
const DocWizard = lazy(() => import('./pages/seller/DocWizard'));
const SellerOrders = lazy(() => import('./pages/seller/Orders'));
const SellerOrderView = lazy(() => import('./pages/seller/OrderView'));
const OrderProcess = lazy(() => import('./pages/seller/OrderProcess'));
const SellerQuotes = lazy(() => import('./pages/seller/Quotes'));
const SellerQuoteView = lazy(() => import('./pages/seller/QuoteView'));
const Catalog = lazy(() => import('./pages/seller/Catalog'));

function RequireRole({ role, children }: { role?: 'ADMIN' | 'SELLER'; children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (me.user.mustChangePassword) return <Navigate to="/trocar-senha" replace />;
  if (role && me.user.role !== role) return <Navigate to={me.user.role === 'ADMIN' ? '/admin' : '/vendedor'} replace />;
  return <>{children}</>;
}

function Home() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={me.user.role === 'ADMIN' ? '/admin' : '/vendedor'} replace />;
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route path="/" element={<Home />} />
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
            <RequireRole role="ADMIN">
              <AppShell />
            </RequireRole>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="clientes" element={<Clients />} />
          <Route path="clientes/novo" element={<ClientForm />} />
          <Route path="clientes/:id" element={<ClientForm />} />
          <Route path="produtos" element={<Products />} />
          <Route path="produtos/novo" element={<ProductForm />} />
          <Route path="produtos/:id" element={<ProductForm />} />
          <Route path="marcas" element={<Brands />} />
          <Route path="vendedores" element={<Reps />} />
          <Route path="vendedores/novo" element={<RepForm />} />
          <Route path="vendedores/:id" element={<RepForm />} />
          <Route path="pedidos" element={<AdminOrders />} />
          <Route path="pedidos/:id" element={<AdminOrderDetail />} />
          <Route path="orcamentos" element={<AdminQuotes />} />
          <Route path="orcamentos/:id" element={<AdminQuoteDetail />} />
          <Route path="aprovacoes" element={<Approvals />} />
          <Route path="estoque" element={<Stock />} />
          <Route path="relatorios" element={<Reports />} />
          <Route path="auditoria" element={<Audit />} />
          <Route path="configuracoes" element={<Settings />} />
        </Route>
        <Route
          path="/vendedor"
          element={
            <RequireRole role="SELLER">
              <AppShell />
            </RequireRole>
          }
        >
          <Route index element={<SellerHome />} />
          <Route path="novo-pedido" element={<DocWizard mode="order" />} />
          <Route path="pedidos/:id/editar" element={<DocWizard mode="order" />} />
          <Route path="novo-orcamento" element={<DocWizard mode="quote" />} />
          <Route path="orcamentos/:id/editar" element={<DocWizard mode="quote" />} />
          <Route path="pedidos" element={<SellerOrders />} />
          <Route path="pedidos/:id" element={<SellerOrderView />} />
          <Route path="processo" element={<OrderProcess />} />
          <Route path="orcamentos" element={<SellerQuotes />} />
          <Route path="orcamentos/:id" element={<SellerQuoteView />} />
          <Route path="catalogo" element={<Catalog />} />
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </Suspense>
  );
}
