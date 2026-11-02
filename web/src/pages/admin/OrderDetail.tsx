import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRightLeft, RotateCcw, ScrollText, Warehouse } from 'lucide-react';
import { ORDER_STATUS_LABELS, ORDER_TERMINAL_STATUSES, STOCK_MOVEMENT_LABELS, formatCnpj, formatDateBR, formatDateTimeBR, formatPhone, type OrderStatus } from '@della/shared';
import { api, errorMessage } from '../../lib/api';
import { AUDIT_LABELS } from '../../lib/labels';
import { Alert, Button, Card, CardTitle, ErrorState, Field, KeyValue, Loading, Modal, PageHeader, Select, Textarea } from '../../components/ui';
import { ApprovalBadge, OrderStatusBadge, OrderTimeline, PdfActions } from '../../components/common';
import { ItemsTable, TotalsCard } from '../../components/docs';

export default function AdminOrderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-order', id], queryFn: () => api<any>(`/admin/orders/${id}`) });
  const [modal, setModal] = useState<null | 'status' | 'reopen'>(null);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');

  const change = useMutation({
    mutationFn: () => api(`/admin/orders/${id}/${modal === 'reopen' ? 'reopen' : 'status'}`, { body: { status: to, note: note || null } }),
    onSuccess: () => {
      toast.success('Status atualizado.');
      setModal(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['admin-order', id] });
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const terminal = ORDER_TERMINAL_STATUSES.includes(o.status);
  const reopenTargets = (Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).filter((s) => s !== 'DRAFT' && !ORDER_TERMINAL_STATUSES.includes(s));

  return (
    <>
      <PageHeader
        back="/admin/pedidos"
        title={<span className="flex flex-wrap items-center gap-3">Pedido {o.number ?? '(rascunho)'} <OrderStatusBadge status={o.status} /> <ApprovalBadge status={o.discountApprovalStatus} /></span>}
        subtitle={`${formatDateBR(o.orderDate)} • ${o.salesRep.fullName}${o.quote ? ` • origem: orçamento ${o.quote.number}` : ''}`}
        actions={
          o.status !== 'DRAFT' && (
            terminal ? (
              <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => { setTo('CREATED'); setModal('reopen'); }}>Reabrir pedido</Button>
            ) : (
              <Button icon={<ArrowRightLeft className="size-4" />} disabled={!o.allowedTransitions.length} onClick={() => { setTo(o.allowedTransitions[0] ?? ''); setModal('status'); }}>Alterar status</Button>
            )
          )
        }
      />
      {o.discountApprovalStatus === 'PENDING' && (
        <div className="mb-4"><Alert tone="amber" title="Desconto aguardando decisão">Este pedido tem um desconto acima do limite do vendedor. Decida em <Link className="underline" to="/admin/aprovacoes">Aprovações</Link>.</Alert></div>
      )}
      {o.status === 'CANCELLED' && o.cancelReason && <div className="mb-4"><Alert tone="red" title="Pedido cancelado">{o.cancelReason}</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardTitle>Cliente e condições</CardTitle>
            <KeyValue
              items={[
                ['Cliente', <Link className="text-navy-700 hover:underline" to={`/admin/clientes/${o.client.id}`}>{o.client.legalName}</Link>],
                ['CNPJ', formatCnpj(o.client.cnpj)],
                ['Contato', [o.client.responsibleName, o.client.commercialPhone && formatPhone(o.client.commercialPhone), o.client.commercialEmail].filter(Boolean).join(' • ')],
                ['Vendedor', o.salesRep.fullName],
                ['Condição de pagamento', o.paymentTermName ? `${o.paymentTermName}${o.paymentDays ? ` (${o.paymentDays} dias)` : ''}` : null],
                ['Previsão de entrega', o.expectedDelivery ? formatDateBR(o.expectedDelivery) : null],
                ['Confirmado em', o.confirmedAt ? formatDateTimeBR(o.confirmedAt) : null],
                ['Observações', o.notes],
              ]}
            />
          </Card>
          <Card padded={false}>
            <div className="p-5 pb-2"><CardTitle className="mb-0">Itens do pedido</CardTitle></div>
            <ItemsTable items={o.items} showCost />
          </Card>
          {o.approvals.length > 0 && (
            <Card>
              <CardTitle>Solicitações de desconto</CardTitle>
              <ul className="divide-y divide-line text-sm">
                {o.approvals.map((a: any) => (
                  <li key={a.id} className="py-2">
                    <p><strong>{(a.requestedBps / 100).toFixed(2).replace('.', ',')}%</strong> solicitado (limite {(a.maxAllowedBps / 100).toFixed(2).replace('.', ',')}%) — <ApprovalBadge status={a.status} /></p>
                    <p className="text-xs text-muted">{formatDateTimeBR(a.createdAt)}{a.reason && ` • Motivo: ${a.reason}`}{a.decidedBy && ` • Decidido por ${a.decidedBy.name} em ${formatDateTimeBR(a.decidedAt)}`}{a.decisionNote && ` • ${a.decisionNote}`}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {o.stockMovements?.length > 0 && (
            <Card>
              <CardTitle icon={<Warehouse className="size-4" />}>Movimentações de estoque</CardTitle>
              <ul className="divide-y divide-line text-sm">
                {o.stockMovements.map((m: any) => (
                  <li key={m.id} className="flex justify-between gap-3 py-2"><span>{STOCK_MOVEMENT_LABELS[m.type as keyof typeof STOCK_MOVEMENT_LABELS]} • {m.product.sku}</span><span className="tabular text-muted">{m.quantity > 0 ? '+' : ''}{m.quantity} • {formatDateTimeBR(m.createdAt)}</span></li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardTitle icon={<ScrollText className="size-4" />}>Auditoria do pedido</CardTitle>
            <ul className="space-y-2 text-sm">
              {o.audit.map((a: any) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2">
                  <span>{AUDIT_LABELS[a.action] ?? a.action}{a.data?.note ? ` — ${a.data.note}` : ''}</span>
                  <span className="text-xs text-muted">{formatDateTimeBR(a.createdAt)} • {a.user?.name ?? 'Sistema'}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-6">
          <TotalsCard doc={o} internal />
          <Card>
            <CardTitle>Processo do pedido</CardTitle>
            <OrderTimeline status={o.status} history={o.statusHistory} />
          </Card>
          <PdfActions kind="orders" id={o.id} number={o.number} clientPhone={o.client.commercialPhone} />
        </div>
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'reopen' ? 'Reabrir pedido (ação administrativa)' : 'Alterar status do pedido'}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Cancelar</Button><Button variant={to === 'CANCELLED' || to === 'REJECTED' ? 'danger' : 'primary'} loading={change.isPending} onClick={() => change.mutate()} disabled={!to}>Confirmar alteração</Button></>}
      >
        <div className="space-y-4">
          <p className="text-sm">Status atual: <OrderStatusBadge status={o.status} /></p>
          <Field label="Novo status">
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {(modal === 'reopen' ? reopenTargets : (o.allowedTransitions as OrderStatus[])).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          <Field label={modal === 'reopen' ? 'Justificativa (obrigatória)' : to === 'CANCELLED' ? 'Motivo do cancelamento (obrigatório)' : 'Observação'} hint="Fica registrada no histórico com data, hora e usuário.">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {modal === 'reopen' && <Alert tone="amber">Reabrir um pedido finalizado é uma ação excepcional e fica registrada na auditoria.</Alert>}
        </div>
      </Modal>
    </>
  );
}
