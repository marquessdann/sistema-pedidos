import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { CLIENT_STATUS_LABELS, formatCnpj, formatDateBR, formatPhone } from '@della/shared';
import { api, errorMessage } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Modal } from '../../components/ui';
import { useDebounced } from '../../lib/hooks';
import { Card, DataTable, ErrorState, Input, LinkButton, PageHeader, Pagination, Select } from '../../components/ui';
import { ClientStatusBadge } from '../../components/common';

interface ClientRow {
  id: string;
  legalName: string;
  tradeName: string | null;
  cnpj: string;
  city: string | null;
  state: string | null;
  commercialPhone: string | null;
  status: string;
  createdAt: string;
  salesRep: { fullName: string } | null;
  availableToAllReps: boolean;
}

export default function Clients() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isAdmin, can } = useRole();
  const [release, setRelease] = useState<ClientRow | null>(null);
  const [newStatus, setNewStatus] = useState('ACTIVE');
  const saveStatus = useMutation({
    mutationFn: () => api(`/admin/clients/${release!.id}/status`, { body: { status: newStatus } }),
    onSuccess: () => {
      toast.success('Status do cliente atualizado.');
      setRelease(null);
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [salesRepId, setRep] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'name' | 'recent'>('name');
  const dq = useDebounced(q);
  const reps = useQuery({ queryKey: ['reps'], queryFn: () => api<{ id: string; fullName: string }[]>('/admin/reps') });
  const list = useQuery({
    queryKey: ['clients', dq, status, salesRepId, page, sort],
    queryFn: () => api<{ items: ClientRow[]; total: number; pages: number; page: number }>('/admin/clients', { query: { q: dq, status, salesRepId, page, sort } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle={isAdmin ? 'Cadastro e liberação de clientes para os representantes' : 'Clientes dos vendedores que você acompanha'}
        actions={isAdmin && <LinkButton to="/admin/clientes/novo" variant="primary" icon={<Plus className="size-4" />}>Novo cliente</LinkButton>}
      />
      <Card padded={false}>
        <div className="grid gap-3 border-b border-line p-4 md:grid-cols-[1fr_200px_200px_160px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input className="pl-9" placeholder="Razão social, fantasia, CNPJ, responsável ou cidade" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">Todos os status</option>
            {Object.entries(CLIENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={salesRepId} onChange={(e) => { setRep(e.target.value); setPage(1); }} aria-label="Vendedor">
            <option value="">Todos os vendedores</option>
            {reps.data?.map((r) => <option key={r.id} value={r.id}>{r.fullName}</option>)}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as 'name')} aria-label="Ordenação">
            <option value="name">Ordem alfabética</option>
            <option value="recent">Mais recentes</option>
          </Select>
        </div>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <DataTable
            rows={list.data?.items}
            loading={list.isFetching}
            rowKey={(r) => r.id}
            onRowClick={
              isAdmin
                ? (r) => nav(`/admin/clientes/${r.id}`)
                : can('canReleaseClients')
                  ? (r) => {
                      setNewStatus(r.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE');
                      setRelease(r);
                    }
                  : undefined
            }
            mobileCard={(r) => (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-900">{r.tradeName ?? r.legalName}</p>
                  {r.tradeName && <p className="truncate text-xs text-muted">{r.legalName}</p>}
                  <p className="text-sm tabular">{formatCnpj(r.cnpj)}</p>
                  <p className="text-xs text-muted">{[[r.city, r.state].filter(Boolean).join('/'), r.salesRep?.fullName ?? (r.availableToAllReps ? 'Todos os vendedores' : 'Sem vendedor')].filter(Boolean).join(' • ')}</p>
                </div>
                <ClientStatusBadge status={r.status} />
              </div>
            )}
            columns={[
              { key: 'name', header: 'Cliente', render: (r) => (<div><p className="font-medium text-navy-900">{r.legalName}</p>{r.tradeName && <p className="text-xs text-muted">{r.tradeName}</p>}</div>) },
              { key: 'cnpj', header: 'CNPJ', render: (r) => <span className="tabular whitespace-nowrap">{formatCnpj(r.cnpj)}</span> },
              { key: 'city', header: 'Cidade/UF', hideOnMobile: true, render: (r) => [r.city, r.state].filter(Boolean).join('/') || '—' },
              { key: 'phone', header: 'Telefone', hideOnMobile: true, render: (r) => (r.commercialPhone ? formatPhone(r.commercialPhone) : '—') },
              { key: 'rep', header: 'Vendedor', hideOnMobile: true, render: (r) => r.salesRep?.fullName ?? (r.availableToAllReps ? 'Todos' : '—') },
              { key: 'created', header: 'Cadastro', hideOnMobile: true, render: (r) => formatDateBR(r.createdAt) },
              { key: 'status', header: 'Status', render: (r) => <ClientStatusBadge status={r.status} /> },
            ]}
          />
        )}
        {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
      </Card>
      <Modal
        open={!!release}
        onClose={() => setRelease(null)}
        title="Liberação do cliente"
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setRelease(null)}>Cancelar</Button><Button loading={saveStatus.isPending} onClick={() => saveStatus.mutate()}>Salvar</Button></>}
      >
        {release && (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-navy-900">{release.legalName}</p>
              <p className="text-sm text-muted">{formatCnpj(release.cnpj)} • status atual: <ClientStatusBadge status={release.status} /></p>
            </div>
            <Field label="Novo status">
              <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                {Object.entries(CLIENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <p className="text-xs text-muted">Somente clientes “Ativos” podem receber pedidos do vendedor. Alterações de cadastro são feitas pelo administrador.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
