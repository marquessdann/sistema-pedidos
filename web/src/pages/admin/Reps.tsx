import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { formatBps, formatDateBR, formatDateTimeBR, formatPhone } from '@della/shared';
import { api } from '../../lib/api';
import { Badge, Card, DataTable, ErrorState, LinkButton, PageHeader } from '../../components/ui';

export default function Reps() {
  const nav = useNavigate();
  const list = useQuery({ queryKey: ['reps'], queryFn: () => api<any[]>('/admin/reps') });
  return (
    <>
      <PageHeader title="Vendedores" subtitle="Representantes comerciais, limites de desconto e permissões" actions={<LinkButton to="/admin/vendedores/novo" variant="primary" icon={<Plus className="size-4" />}>Novo vendedor</LinkButton>} />
      <Card padded={false}>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <DataTable
            rows={list.data}
            loading={list.isLoading}
            rowKey={(r) => r.id}
            onRowClick={(r) => nav(`/admin/vendedores/${r.id}`)}
            columns={[
              { key: 'name', header: 'Nome', render: (r) => (<div><p className="font-medium text-navy-900">{r.fullName}</p><p className="text-xs text-muted">{r.title} • usuário: {r.username}</p></div>) },
              { key: 'phone', header: 'Telefone', hideOnMobile: true, render: (r) => (r.phone ? formatPhone(r.phone) : <span className="text-amber-700">Pendente</span>) },
              { key: 'disc', header: 'Desc. máximo', align: 'right', render: (r) => formatBps(r.maxDiscountBps) },
              { key: 'comm', header: 'Comissão', align: 'right', hideOnMobile: true, render: (r) => (r.commissionBps === null ? '—' : formatBps(r.commissionBps)) },
              { key: 'clients', header: 'Clientes', align: 'right', hideOnMobile: true, render: (r) => r.clientCount },
              { key: 'login', header: 'Último acesso', hideOnMobile: true, render: (r) => (r.lastLoginAt ? formatDateTimeBR(r.lastLoginAt) : 'Nunca') },
              { key: 'created', header: 'Cadastro', hideOnMobile: true, render: (r) => formatDateBR(r.createdAt) },
              { key: 'status', header: 'Status', render: (r) => (<div className="flex flex-wrap gap-1">{r.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="red">Inativo</Badge>}{r.mustChangePassword && <Badge tone="amber">Troca de senha pendente</Badge>}</div>) },
            ]}
          />
        )}
      </Card>
    </>
  );
}
