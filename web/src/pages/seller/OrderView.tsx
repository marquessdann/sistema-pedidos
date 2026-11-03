import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Copy, History, Pencil, Trash2 } from 'lucide-react';
import { ORDER_STATUS_LABELS, formatCnpj, formatDateBR, formatDateTimeBR } from '@della/shared';
import { api, errorMessage, newKey } from '../../lib/api';
import { AUDIT_LABELS } from '../../lib/labels';
import { Alert, Button, Card, CardTitle, ErrorState, KeyValue, LinkButton, Loading, Modal, PageHeader, useConfirm } from '../../components/ui';
import { ApprovalBadge, OrderStatusBadge, OrderTimeline, PdfActions, StatusHistoryList } from '../../components/common';
import { ItemsTable, TotalsCard } from '../../components/docs';

export default function SellerOrderView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [histOpen, setHistOpen] = useState(false);
  const q = useQuery({ queryKey: ['seller-order', id], queryFn: () => api<any>(`/seller/orders/${id}`), staleTime: 0, refetchOnMount: 'always' });
  const hist = useQuery({ queryKey: ['seller-order-hist', id], queryFn: () => api<any>(`/seller/orders/${id}/history`), enabled: histOpen });
  const dup = useMutation({
    mutationFn: () => api<any>(`/seller/orders/${id}/duplicate`, { body: { idempotencyKey: newKey() } }),
    onSuccess: (r) => {
      toast.success(`Novo rascunho criado com os preços atuais${r.skipped ? ` (${r.skipped} produto(s) inativo(s) ignorado(s))` : ''}.`);
      nav(`/vendedor/pedidos/${r.order.id}/editar`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/seller/orders/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success('Rascunho excluído.'); void qc.invalidateQueries({ queryKey: ['seller-orders'] }); nav('/vendedor/pedidos'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const o = q.data;
  const isDraft = o.status === 'DRAFT';
  return (
    <>
      <PageHeader
        back="/vendedor/pedidos"
        title={<span className="flex flex-wrap items-center gap-3">{o.number ? `Pedido ${o.number}` : 'Rascunho de pedido'} <OrderStatusBadge status={o.status} /> <ApprovalBadge status={o.discountApprovalStatus} /></span>}
        subtitle={`${formatDateBR(o.orderDate)} • ${o.client.tradeName ?? o.client.legalName}${o.quote ? ` • origem: orçamento ${o.quote.number}` : ''}`}
        actions={
          !o.readOnly && (
            <>
              <Button variant="secondary" icon={<History className="size-4" />} onClick={() => setHistOpen(true)}>Histórico</Button>
              {isDraft ? (
                <>
                  {!o.number && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => (await confirm({ title: 'Excluir rascunho?', message: 'Esta ação não pode ser desfeita.', tone: 'danger', confirmLabel: 'Excluir' })) && del.mutate()}>Excluir</Button>}
                  <LinkButton to={`/vendedor/pedidos/${o.id}/editar`} variant="primary" icon={<Pencil className="size-4" />}>Continuar editando</LinkButton>
                </>
              ) : (
                <Button variant="secondary" icon={<Copy className="size-4" />} loading={dup.isPending} onClick={async () => (await confirm({ title: 'Duplicar pedido?', message: 'Será criado um novo rascunho com os mesmos produtos e quantidades, usando os preços atuais do catálogo.' })) && dup.mutate()}>Duplicar pedido</Button>
              )}
            </>
          )
        }
      />
      {params.get('novo') && !isDraft && (
        <div className="mb-4">
          <Alert tone="green" icon={<CheckCircle2 className="size-4" />} title={o.status === 'PENDING_APPROVAL' ? 'Pedido registrado e enviado para aprovação' : 'Pedido confirmado com sucesso'}>
            Número {o.number}. Gere o PDF abaixo para enviar ao cliente.
          </Alert>
        </div>
      )}
      {isDraft && o.number && <div className="mb-4"><Alert tone="amber" title="Desconto não aprovado">O administrador reprovou o desconto solicitado. Ajuste o desconto e confirme novamente — o número {o.number} será mantido.</Alert></div>}
      {o.readOnly && <div className="mb-4"><Alert tone="navy">Pedido de {o.salesRep.fullName} — visualização somente leitura.</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardTitle>Dados do pedido</CardTitle>
            <KeyValue items={[
              ['Cliente', o.client.legalName],
              ['CNPJ', formatCnpj(o.client.cnpj)],
              ['Vendedor', o.salesRep.fullName],
              ['Condição de pagamento', o.paymentTermName ? `${o.paymentTermName}${o.paymentDays ? ` (${o.paymentDays} dias)` : ''}` : 'A combinar'],
              ['Previsão de entrega', o.expectedDelivery ? formatDateBR(o.expectedDelivery) : null],
              ['Confirmado em', o.confirmedAt ? formatDateTimeBR(o.confirmedAt) : null],
              ['Observações', o.notes],
            ]} />
          </Card>
          <Card padded={false}><div className="p-5 pb-2"><CardTitle className="mb-0">Produtos</CardTitle></div><ItemsTable items={o.items} /></Card>
        </div>
        <div className="space-y-6">
          <TotalsCard doc={o} />
          <PdfActions kind="orders" id={o.id} number={o.number} clientPhone={o.client.commercialPhone} />
          <Card>
            <CardTitle>Andamento</CardTitle>
            <OrderTimeline status={o.status} history={o.statusHistory} />
            <Link to={`/vendedor/processo?pedido=${o.id}`} className="mt-4 inline-block text-sm text-navy-700 hover:underline">Abrir em “Processo do pedido”</Link>
          </Card>
        </div>
      </div>
      <Modal open={histOpen} onClose={() => setHistOpen(false)} title="Histórico de alterações" size="lg">
        {hist.isLoading ? <Loading /> : hist.data && (
          <div className="grid gap-6 md:grid-cols-2">
            <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Status</p><StatusHistoryList history={hist.data.status} labels={ORDER_STATUS_LABELS} /></div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Operações</p>
              <ul className="divide-y divide-line text-sm">{hist.data.audit.map((a: any) => <li key={a.id} className="py-2"><p>{AUDIT_LABELS[a.action] ?? a.action}</p><p className="text-xs text-muted">{formatDateTimeBR(a.createdAt)} • {a.user?.name ?? 'Sistema'}</p></li>)}</ul>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
