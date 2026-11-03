import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { formatBRL, formatBps, formatDateTimeBR } from '@della/shared';
import { api, errorMessage } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { Button, Card, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, Tabs, Textarea, cx } from '../../components/ui';
import { ApprovalBadge } from '../../components/common';

export default function Approvals() {
  const qc = useQueryClient();
  const { isAdmin } = useRole();
  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [decide, setDecide] = useState<{ id: string; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const list = useQuery({ queryKey: ['approvals', tab], queryFn: () => api<any>('/admin/approvals', { query: { status: tab, pageSize: 100 } }) });
  const m = useMutation({
    mutationFn: () => api(`/admin/approvals/${decide!.id}/decide`, { body: { decision: decide!.decision, note: note || null } }),
    onSuccess: () => {
      toast.success(decide!.decision === 'APPROVED' ? 'Desconto aprovado.' : 'Desconto reprovado.');
      setDecide(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['approvals-count'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Aprovações de desconto" subtitle="Descontos acima do limite individual do vendedor" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'PENDING', label: 'Pendentes' }, { value: 'APPROVED', label: 'Aprovadas' }, { value: 'REJECTED', label: 'Reprovadas/canceladas' }]} />
      {list.isLoading ? <Loading /> : list.isError ? <ErrorState error={list.error} /> : list.data.items.length === 0 ? (
        <Card><EmptyState title="Nenhuma solicitação" description={tab === 'PENDING' ? 'Não há descontos aguardando decisão.' : undefined} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data.items.map((a: any) => {
            const doc = a.order ?? a.quote;
            const isOrder = !!a.order;
            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link to={isOrder ? `/admin/pedidos/${doc.id}` : `/admin/orcamentos/${doc.id}`} className="font-semibold text-navy-900 hover:underline">{isOrder ? 'Pedido' : 'Orçamento'} {doc.number ?? ''}</Link>
                    <p className="text-sm text-muted">{doc.client.legalName} • {a.salesRep.fullName}</p>
                  </div>
                  <ApprovalBadge status={a.status} />
                </div>
                <div className="my-4 grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
                  <div><p className="text-xs text-muted">Desconto solicitado</p><p className="text-lg font-semibold text-red-600 tabular">{formatBps(a.requestedBps)}</p></div>
                  <div><p className="text-xs text-muted">Limite do vendedor</p><p className="text-lg font-semibold tabular">{formatBps(a.maxAllowedBps)}</p></div>
                  <div><p className="text-xs text-muted">Valor final</p><p className="text-lg font-semibold tabular">{formatBRL(a.totalCents)}</p></div>
                  <div><p className="text-xs text-muted">Bruto</p><p className="tabular">{formatBRL(doc.grossCents)}</p></div>
                  {isAdmin && <div><p className="text-xs text-muted">Margem estimada</p><p className={cx('tabular', doc.marginCents < 0 && 'text-red-600')}>{doc.marginCents != null ? formatBRL(doc.marginCents) : '—'}</p></div>}
                  <div><p className="text-xs text-muted">Desc. geral</p><p className="tabular">{formatBps(a.generalDiscountBps)}</p></div>
                </div>
                {a.reason && <p className="mb-2 text-sm"><span className="text-muted">Justificativa do vendedor:</span> {a.reason}</p>}
                <p className="text-xs text-muted">Solicitado em {formatDateTimeBR(a.createdAt)}{a.decidedAt && ` • Decidido em ${formatDateTimeBR(a.decidedAt)}${a.decidedBy ? ` por ${a.decidedBy.name}` : ''}`}{a.decisionNote && ` • ${a.decisionNote}`}</p>
                {a.status === 'PENDING' && (
                  <div className="mt-4 flex gap-2">
                    <Button variant="success" icon={<Check className="size-4" />} onClick={() => setDecide({ id: a.id, decision: 'APPROVED' })}>Aprovar</Button>
                    <Button variant="danger" icon={<X className="size-4" />} onClick={() => setDecide({ id: a.id, decision: 'REJECTED' })}>Reprovar</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <Modal open={!!decide} onClose={() => setDecide(null)} title={decide?.decision === 'APPROVED' ? 'Aprovar desconto' : 'Reprovar desconto'} size="sm"
        footer={<><Button variant="secondary" onClick={() => setDecide(null)}>Cancelar</Button><Button variant={decide?.decision === 'APPROVED' ? 'success' : 'danger'} loading={m.isPending} onClick={() => m.mutate()}>Confirmar</Button></>}>
        <p className="mb-3 text-sm text-muted">{decide?.decision === 'APPROVED' ? 'O pedido seguirá como “Pedido aprovado”.' : 'Pedidos voltam ao vendedor como rascunho para ajuste do desconto.'}</p>
        <Field label="Observação (registrada no histórico)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
