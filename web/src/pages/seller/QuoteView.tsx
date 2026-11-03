import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRightCircle, CheckCircle2, Copy, Pencil, Send, ThumbsDown, ThumbsUp } from 'lucide-react';
import { QUOTE_OPEN_STATUSES, QUOTE_STATUS_LABELS, formatBRL, formatBps, formatCnpj, formatDateBR, type QuoteStatus } from '@della/shared';
import { api, errorMessage, newKey } from '../../lib/api';
import { Alert, Button, Card, CardTitle, ErrorState, Field, Input, KeyValue, LinkButton, Loading, Modal, PageHeader, Select, Textarea, cx, useConfirm } from '../../components/ui';
import { ApprovalBadge, OrderStatusBadge, PdfActions, QuoteStatusBadge, StatusHistoryList } from '../../components/common';
import { ItemsTable, TotalsCard } from '../../components/docs';

export default function SellerQuoteView() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [convertOpen, setConvertOpen] = useState(false);
  const q = useQuery({ queryKey: ['seller-quote', id], queryFn: () => api<any>(`/seller/quotes/${id}`) });
  const status = useMutation({
    mutationFn: (s: string) => api(`/seller/quotes/${id}/status`, { body: { status: s } }),
    onSuccess: () => { toast.success('Status do orçamento atualizado.'); void qc.invalidateQueries({ queryKey: ['seller-quote', id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const dup = useMutation({
    mutationFn: () => api<any>(`/seller/quotes/${id}/duplicate`, { body: { idempotencyKey: newKey() } }),
    onSuccess: (r) => { toast.success(`Orçamento ${r.quote.number} criado.`); nav(`/vendedor/orcamentos/${r.quote.id}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data;
  const open = (QUOTE_OPEN_STATUSES as string[]).includes(d.status);
  const setStatus = async (s: QuoteStatus, msg: string) => (await confirm({ title: `Marcar como “${QUOTE_STATUS_LABELS[s]}”?`, message: msg })) && status.mutate(s);

  return (
    <>
      <PageHeader
        back="/vendedor/orcamentos"
        title={<span className="flex flex-wrap items-center gap-3">Orçamento {d.number} <QuoteStatusBadge status={d.status} /> <ApprovalBadge status={d.discountApprovalStatus} /></span>}
        subtitle={`${formatDateBR(d.quoteDate)} • válido até ${formatDateBR(d.validUntil)} • ${d.client.tradeName ?? d.client.legalName}`}
        actions={!d.readOnly && (
          <>
            <Button variant="secondary" icon={<Copy className="size-4" />} loading={dup.isPending} onClick={() => dup.mutate()}>Duplicar</Button>
            {open && <LinkButton to={`/vendedor/orcamentos/${d.id}/editar`} icon={<Pencil className="size-4" />}>Editar</LinkButton>}
            {open && <Button variant="gold" size="lg" icon={<ArrowRightCircle className="size-5" />} onClick={() => setConvertOpen(true)}>Transformar em pedido</Button>}
          </>
        )}
      />
      {params.get('novo') && <div className="mb-4"><Alert tone="green" icon={<CheckCircle2 className="size-4" />} title="Orçamento salvo">Gere o PDF e compartilhe com o cliente. Quando ele aprovar, use “Transformar em pedido”.</Alert></div>}
      {d.discountApprovalStatus === 'PENDING' && <div className="mb-4"><Alert tone="amber" title="Aguardando aprovação do desconto">O PDF, o envio ao cliente e a conversão em pedido serão liberados após a decisão do administrador.</Alert></div>}
      {d.discountApprovalStatus === 'REJECTED' && open && <div className="mb-4"><Alert tone="red" title="Desconto reprovado">Edite o orçamento e ajuste o desconto para o seu limite.</Alert></div>}
      {d.convertedOrder && <div className="mb-4"><Alert tone="navy" title="Convertido em pedido">Pedido <Link className="font-semibold underline" to={`/vendedor/pedidos/${d.convertedOrder.id}`}>{d.convertedOrder.number}</Link> <OrderStatusBadge status={d.convertedOrder.status} />. O histórico do orçamento foi preservado.</Alert></div>}
      <div className="mb-5 xl:hidden"><PdfActions kind="quotes" id={d.id} number={d.number} clientPhone={d.client.commercialPhone} disabledReason={d.discountApprovalStatus === 'PENDING' ? 'Disponível após a aprovação do desconto.' : null} /></div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardTitle>Dados da proposta</CardTitle>
            <KeyValue items={[['Cliente', d.client.legalName], ['CNPJ', formatCnpj(d.client.cnpj)], ['Condição de pagamento', d.paymentTermName ?? 'A combinar'], ['Previsão de entrega', d.expectedDelivery ? formatDateBR(d.expectedDelivery) : null], ['Validade', formatDateBR(d.validUntil)], ['Observações', d.notes]]} />
          </Card>
          <Card padded={false}><div className="p-5 pb-2"><CardTitle className="mb-0">Produtos</CardTitle></div><ItemsTable items={d.items} /></Card>
          <Card><CardTitle>Histórico do orçamento</CardTitle><StatusHistoryList history={d.statusHistory} labels={QUOTE_STATUS_LABELS} /></Card>
        </div>
        <div className="space-y-6">
          <TotalsCard doc={d} title="Resumo da proposta" />
          <div className="hidden xl:block"><PdfActions kind="quotes" id={d.id} number={d.number} clientPhone={d.client.commercialPhone} disabledReason={d.discountApprovalStatus === 'PENDING' ? 'Disponível após a aprovação do desconto.' : null} /></div>
          {open && !d.readOnly && (
            <Card>
              <CardTitle>Situação com o cliente</CardTitle>
              <div className="grid gap-2">
                <Button variant="secondary" icon={<Send className="size-4" />} disabled={d.status === 'SENT'} onClick={() => setStatus('SENT', 'Registre que a proposta foi enviada ao cliente.')}>Enviado ao cliente</Button>
                <Button variant="secondary" disabled={d.status === 'AWAITING_RESPONSE'} onClick={() => setStatus('AWAITING_RESPONSE', 'O cliente está analisando a proposta.')}>Aguardando retorno</Button>
                <Button variant="secondary" icon={<ThumbsUp className="size-4" />} disabled={d.status === 'APPROVED_BY_CLIENT'} onClick={() => setStatus('APPROVED_BY_CLIENT', 'O cliente aprovou a proposta. Em seguida, transforme em pedido.')}>Aprovado pelo cliente</Button>
                <Button variant="ghost" icon={<ThumbsDown className="size-4" />} onClick={() => setStatus('REJECTED', 'O orçamento será marcado como recusado e não poderá mais ser convertido.')}>Recusado</Button>
              </div>
            </Card>
          )}
        </div>
      </div>
      {convertOpen && <ConvertModal quoteId={d.id} quoteNumber={d.number} onClose={() => setConvertOpen(false)} />}
    </>
  );
}

function ConvertModal({ quoteId, quoteNumber, onClose }: { quoteId: string; quoteNumber: string; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [key] = useState(newKey());
  const [ack, setAck] = useState(false);
  const preview = useQuery({ queryKey: ['conv-preview', quoteId], queryFn: () => api<any>(`/seller/quotes/${quoteId}/conversion-preview`) });
  const config = useQuery({ queryKey: ['seller-config'], queryFn: () => api<any>('/seller/config') });
  const [terms, setTerms] = useState<{ paymentTermId?: string; notes?: string; expectedDelivery?: string } | null>(null);
  const p = preview.data;
  const t = terms ?? (p ? { paymentTermId: p.paymentTermId ?? '', notes: p.notes ?? '', expectedDelivery: p.expectedDelivery ?? '' } : null);
  const convert = useMutation({
    mutationFn: () => api<any>(`/seller/quotes/${quoteId}/convert`, { body: { idempotencyKey: key, acknowledgePriceChange: ack, paymentTermId: t?.paymentTermId || null, notes: t?.notes ?? null, expectedDelivery: t?.expectedDelivery || null } }),
    onSuccess: (r) => {
      toast.success(r.duplicate ? `Pedido ${r.order.number} já havia sido criado (sem duplicação).` : `Pedido ${r.order.number} criado a partir do orçamento ${quoteNumber}.`);
      void qc.invalidateQueries();
      nav(`/vendedor/pedidos/${r.order.id}?novo=1`);
    },
    onError: (e) => toast.error(errorMessage(e), { action: { label: 'Tentar novamente', onClick: () => convert.mutate() } }),
  });
  const keep = p?.pricePolicy === 'KEEP_QUOTE_PRICES';
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Transformar o orçamento ${quoteNumber} em pedido`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="success" loading={convert.isPending} disabled={!p?.canConvert || (p?.priceChanged && !ack)} onClick={() => convert.mutate()} icon={<CheckCircle2 className="size-4" />}>Confirmar e criar pedido</Button></>}
    >
      {preview.isLoading || !p ? <Loading /> : (
        <div className="space-y-5">
          {!p.canConvert && <Alert tone="red" title="Não é possível converter">{p.blockers.map((b: string) => <p key={b}>{b}</p>)}</Alert>}
          {p.priceChanged && (
            <Alert tone="amber" title="Preços alterados desde o orçamento">
              {keep ? 'Política da empresa: os preços aprovados no orçamento serão mantidos no pedido.' : 'Política da empresa: o pedido usará os preços atuais do catálogo.'}
              <label className="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" className="accent-navy-800" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Estou ciente das diferenças de preço</label>
            </Alert>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted"><th className="py-2 text-left">Produto</th><th className="py-2 text-right">Qtd.</th><th className="py-2 text-right">Preço orçado</th><th className="py-2 text-right">Preço atual</th><th className="py-2 text-right">Desc.</th></tr></thead>
              <tbody>
                {p.items.map((i: any) => (
                  <tr key={i.productId} className={cx('border-b border-line/60', !i.active && 'text-red-600')}>
                    <td className="py-2"><p className="font-medium">{i.productName}</p><p className="text-xs text-muted">{i.sku} • {i.brandName}</p></td>
                    <td className="py-2 text-right tabular">{i.quantity} {i.unit}</td>
                    <td className={cx('py-2 text-right tabular', keep && 'font-semibold')}>{formatBRL(i.quotePriceCents)}</td>
                    <td className={cx('py-2 text-right tabular', i.priceChanged && 'text-amber-700', !keep && 'font-semibold')}>{formatBRL(i.currentPriceCents)}</td>
                    <td className="py-2 text-right tabular">{i.discountBps ? formatBps(i.discountBps) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">Desconto geral: <strong>{formatBps(p.generalDiscountBps)}</strong> • Valor do orçamento: <strong className="tabular">{formatBRL(p.quoteTotalCents)}</strong>{p.priceChanged && !keep && ' (será recalculado com os preços atuais)'}</p>
          {t && (
            <div className="grid gap-4 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
              <p className="sm:col-span-2 text-xs font-semibold uppercase tracking-wide text-muted">Revisar condições comerciais</p>
              <Field label="Condição de pagamento">
                <Select value={t.paymentTermId} onChange={(e) => setTerms({ ...t, paymentTermId: e.target.value })}>
                  <option value="">A combinar</option>
                  {config.data?.paymentTerms.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
              </Field>
              <Field label="Previsão de entrega"><Input type="date" value={t.expectedDelivery} onChange={(e) => setTerms({ ...t, expectedDelivery: e.target.value })} /></Field>
              <Field label="Observações do pedido" className="sm:col-span-2"><Textarea rows={2} value={t.notes} onChange={(e) => setTerms({ ...t, notes: e.target.value })} /></Field>
            </div>
          )}
          <p className="text-xs text-muted">O pedido receberá um número próprio, ficará vinculado a este orçamento e o orçamento será marcado como “Convertido em pedido”. Um orçamento não pode ser convertido duas vezes.</p>
        </div>
      )}
    </Modal>
  );
}
