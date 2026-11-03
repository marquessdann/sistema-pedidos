import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Unlock } from 'lucide-react';
import { QUOTE_STATUS_LABELS, formatCnpj, formatDateBR } from '@della/shared';
import { api, errorMessage } from '../../lib/api';
import { useRole } from '../../lib/auth';
import { Alert, Button, Card, CardTitle, ErrorState, Field, KeyValue, Loading, Modal, PageHeader, Textarea } from '../../components/ui';
import { ApprovalBadge, OrderStatusBadge, PdfActions, QuoteStatusBadge, StatusHistoryList } from '../../components/common';
import { ItemsTable, TotalsCard } from '../../components/docs';

export default function AdminQuoteDetail() {
  const { id } = useParams();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['admin-quote', id], queryFn: () => api<any>(`/admin/quotes/${id}`) });
  const allow = useMutation({
    mutationFn: () => api(`/admin/quotes/${id}/allow-reconversion`, { body: { reason } }),
    onSuccess: () => { toast.success('Nova conversão liberada.'); setOpen(false); void qc.invalidateQueries({ queryKey: ['admin-quote', id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data;
  return (
    <>
      <PageHeader
        back="/admin/orcamentos"
        title={<span className="flex flex-wrap items-center gap-3">Orçamento {d.number} <QuoteStatusBadge status={d.status} /> <ApprovalBadge status={d.discountApprovalStatus} /></span>}
        subtitle={`${formatDateBR(d.quoteDate)} • válido até ${formatDateBR(d.validUntil)} • ${d.salesRep.fullName}`}
        actions={isAdmin && d.status === 'CONVERTED' && <Button variant="secondary" icon={<Unlock className="size-4" />} onClick={() => setOpen(true)}>Liberar nova conversão</Button>}
      />
      {d.convertedOrder && (
        <div className="mb-4"><Alert tone="navy" title="Convertido em pedido">Pedido <Link className="underline" to={`/admin/pedidos/${d.convertedOrder.id}`}>{d.convertedOrder.number}</Link> — <OrderStatusBadge status={d.convertedOrder.status} /></Alert></div>
      )}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardTitle>Cliente e condições</CardTitle>
            <KeyValue items={[['Cliente', d.client.legalName], ['CNPJ', formatCnpj(d.client.cnpj)], ['Condição de pagamento', d.paymentTermName], ['Previsão de entrega', d.expectedDelivery ? formatDateBR(d.expectedDelivery) : null], ['Observações', d.notes]]} />
          </Card>
          <Card padded={false}><div className="p-5 pb-2"><CardTitle className="mb-0">Itens</CardTitle></div><ItemsTable items={d.items} showCost={isAdmin} /></Card>
          {d.orders.length > 0 && (
            <Card>
              <CardTitle>Pedidos vinculados</CardTitle>
              <ul className="space-y-1 text-sm">{d.orders.map((o: any) => <li key={o.id}><Link className="text-navy-700 hover:underline" to={`/admin/pedidos/${o.id}`}>{o.number}</Link> <OrderStatusBadge status={o.status} /></li>)}</ul>
            </Card>
          )}
          <Card><CardTitle>Histórico</CardTitle><StatusHistoryList history={d.statusHistory} labels={QUOTE_STATUS_LABELS} /></Card>
        </div>
        <div className="space-y-6">
          <TotalsCard doc={d} internal={isAdmin} title="Resumo da proposta" />
          <PdfActions kind="quotes" id={d.id} number={d.number} clientPhone={d.client.commercialPhone} disabledReason={d.discountApprovalStatus === 'PENDING' ? 'Aguardando decisão sobre o desconto.' : null} />
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Liberar nova conversão" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={allow.isPending} onClick={() => allow.mutate()}>Liberar</Button></>}>
        <div className="space-y-4">
          <Alert tone="amber">Somente permitido quando o pedido gerado anteriormente estiver cancelado ou reprovado. A ação fica registrada na auditoria.</Alert>
          <Field label="Justificativa (mín. 10 caracteres)"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}
