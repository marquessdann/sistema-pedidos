import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, ClipboardList, FilePlus2, FileSearch, Lock, Mail, Phone, Route, Search, ShoppingCart, User, X } from 'lucide-react';
import { formatBRL, formatCnpj, formatDateBR, formatPhone } from '@della/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDebounced, useSessionState } from '../../lib/hooks';
import { Button, Card, CardTitle, EmptyState, ErrorState, Input, KeyValue, Loading, cx } from '../../components/ui';
import { ClientStatusBadge, OrderStatusBadge, QuoteStatusBadge } from '../../components/common';

interface ClientCard {
  id: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  responsibleName: string | null;
  city: string | null;
  state: string | null;
  status: string;
}

export const SELECTED_CLIENT_KEY = 'della:selected-client';

export default function SellerHome() {
  const { me } = useAuth();
  const [selected, setSelected] = useSessionState<string | null>(SELECTED_CLIENT_KEY, null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useQuery({
    queryKey: ['seller-clients', dq],
    queryFn: () => api<{ items: ClientCard[]; total: number }>('/seller/clients', { query: { q: dq, pageSize: 30 } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <div className="mb-6 overflow-hidden rounded-2xl bg-navy-900 px-6 py-7 text-white shadow-lg sm:px-8">
        <p className="text-sm text-gold-300">{me?.rep?.title ?? 'Representante comercial'}</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Bem-vindo, {me?.rep?.fullName}</h1>
        <div className="mt-3 h-0.5 w-12 bg-gold-400" />
        <p className="mt-3 max-w-2xl text-sm text-navy-200">Selecione o cliente para fazer um pedido, montar um orçamento ou acompanhar o andamento.</p>
      </div>

      {selected ? (
        <ClientPanel id={selected} onClear={() => setSelected(null)} />
      ) : (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-navy-900">Selecione o cliente</h2>
          <div className="relative mb-5">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
            <Input autoFocus className="h-12 rounded-xl pl-12 text-base shadow-sm" placeholder="Pesquise por razão social, nome fantasia, CNPJ ou responsável" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {list.isLoading ? (
            <Loading />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data!.items.length === 0 ? (
            <Card>
              <EmptyState title={q ? 'Nenhum cliente encontrado' : 'Você ainda não tem clientes liberados'} description="Envie os dados cadastrais do novo cliente para o administrador pelo WhatsApp. Assim que ele for cadastrado e ativado, aparecerá aqui." />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.data!.items.map((c) => {
                const ok = c.status === 'ACTIVE';
                return (
                  <button
                    key={c.id}
                    disabled={!ok}
                    onClick={() => setSelected(c.id)}
                    className={cx(
                      'group rounded-xl border bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,35,65,0.04)] transition',
                      ok ? 'border-line hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-md' : 'cursor-not-allowed border-dashed border-line opacity-70',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700 group-hover:bg-gold-50 group-hover:text-gold-600">
                        <Building2 className="size-5" />
                      </div>
                      <ClientStatusBadge status={c.status} />
                    </div>
                    <p className="mt-3 font-semibold text-navy-900">{c.tradeName ?? c.legalName}</p>
                    {c.tradeName && <p className="truncate text-xs text-muted">{c.legalName}</p>}
                    <p className="mt-1 text-sm tabular text-ink">{formatCnpj(c.cnpj)}</p>
                    <p className="mt-1 text-xs text-muted">{[c.responsibleName, [c.city, c.state].filter(Boolean).join('/')].filter(Boolean).join(' • ')}</p>
                    {!ok && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-amber-700">
                        <Lock className="size-3" /> Aguardando liberação do administrador
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function ClientPanel({ id, onClear }: { id: string; onClear: () => void }) {
  const nav = useNavigate();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['seller-client', id], queryFn: () => api<any>(`/seller/clients/${id}`), retry: false });
  if (q.isLoading) return <Loading />;
  if (q.isError) {
    return (
      <Card>
        <ErrorState error={q.error} />
        <div className="text-center"><Button variant="secondary" onClick={onClear}>Selecionar outro cliente</Button></div>
      </Card>
    );
  }
  const c = q.data;
  const actions = [
    { label: 'Realizar novo pedido', desc: 'Catálogo, quantidades e desconto', icon: <ShoppingCart className="size-6" />, to: `/vendedor/novo-pedido?cliente=${id}`, primary: true },
    { label: 'Fazer orçamento', desc: 'Proposta comercial em PDF', icon: <FilePlus2 className="size-6" />, to: `/vendedor/novo-orcamento?cliente=${id}`, primary: true },
    { label: 'Consultar pedidos', desc: 'Pedidos deste cliente', icon: <ClipboardList className="size-6" />, to: `/vendedor/pedidos?cliente=${id}` },
    { label: 'Processo do pedido', desc: 'Andamento e etapas', icon: <Route className="size-6" />, to: `/vendedor/processo?cliente=${id}` },
    { label: 'Orçamentos anteriores', desc: 'Consultar e converter', icon: <FileSearch className="size-6" />, to: `/vendedor/orcamentos?cliente=${id}` },
  ];
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-600">
              <Building2 className="size-7" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Cliente selecionado</p>
              <h2 className="text-xl font-semibold text-navy-900">{c.tradeName ?? c.legalName}</h2>
              <p className="text-sm text-muted">{c.legalName} • CNPJ {formatCnpj(c.cnpj)}</p>
              <div className="mt-2"><ClientStatusBadge status={c.status} /></div>
            </div>
          </div>
          <Button variant="secondary" icon={<X className="size-4" />} onClick={onClear}>Trocar cliente</Button>
        </div>
      </Card>

      {!c.selectable && (
        <Card><EmptyState title="Cliente indisponível" description="Este cliente não está ativo. Solicite a liberação ao administrador." /></Card>
      )}

      {c.selectable && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {actions.map((a) => (
            <button
              key={a.label}
              onClick={() => nav(a.to)}
              className={cx(
                'flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md',
                a.primary ? 'border-navy-900 bg-navy-900 text-white hover:bg-navy-800' : 'border-line bg-white text-navy-900 hover:border-gold-300',
              )}
            >
              <span className={a.primary ? 'text-gold-300' : 'text-gold-500'}>{a.icon}</span>
              <span>
                <span className="block font-semibold">{a.label}</span>
                <span className={cx('block text-xs', a.primary ? 'text-navy-200' : 'text-muted')}>{a.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardTitle icon={<User className="size-4" />}>Contato comercial</CardTitle>
          <KeyValue
            cols={1}
            items={[
              ['Responsável', c.responsibleName],
              ['Telefone', c.commercialPhone ? <a className="inline-flex items-center gap-1 text-navy-700 hover:underline" href={`tel:${c.commercialPhone}`}><Phone className="size-3.5" />{formatPhone(c.commercialPhone)}</a> : null],
              ['E-mail', c.commercialEmail ? <a className="inline-flex items-center gap-1 text-navy-700 hover:underline" href={`mailto:${c.commercialEmail}`}><Mail className="size-3.5" />{c.commercialEmail}</a> : null],
              ...(me?.rep?.canViewFinanceContact ? ([['E-mail financeiro', c.financeEmail]] as [string, string][]) : []),
              ['Cidade', [c.address.city, c.address.state].filter(Boolean).join('/')],
            ]}
          />
        </Card>
        <Card>
          <CardTitle>Resumo comercial</CardTitle>
          <KeyValue
            cols={1}
            items={[
              ['Pedidos realizados', c.stats.orders],
              ['Data do último pedido', c.stats.lastOrderDate ? formatDateBR(c.stats.lastOrderDate) : 'Nenhum pedido ainda'],
              ...(c.stats.totalCents !== undefined ? ([['Total de compras', formatBRL(c.stats.totalCents)]] as [string, string][]) : []),
            ]}
          />
          {c.notes && <p className="mt-4 rounded-lg bg-gold-50 p-3 text-sm text-gold-700">{c.notes}</p>}
        </Card>
        <Card>
          <CardTitle>Histórico recente</CardTitle>
          {c.recentOrders.length === 0 && c.recentQuotes.length === 0 ? (
            <p className="text-sm text-muted">Sem pedidos ou orçamentos.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {c.recentOrders.map((o: any) => (
                <li key={o.id}>
                  <Link to={`/vendedor/pedidos/${o.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-navy-50">
                    <span><span className="font-medium">{o.number ?? 'Rascunho'}</span> <span className="text-xs text-muted">{formatDateBR(o.orderDate)}</span></span>
                    <span className="flex items-center gap-2"><span className="tabular">{formatBRL(o.totalCents)}</span><OrderStatusBadge status={o.status} /></span>
                  </Link>
                </li>
              ))}
              {c.recentQuotes.map((qq: any) => (
                <li key={qq.id}>
                  <Link to={`/vendedor/orcamentos/${qq.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-navy-50">
                    <span><span className="font-medium">{qq.number}</span> <span className="text-xs text-muted">{formatDateBR(qq.quoteDate)}</span></span>
                    <span className="flex items-center gap-2"><span className="tabular">{formatBRL(qq.totalCents)}</span><QuoteStatusBadge status={qq.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
