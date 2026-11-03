import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, FileText, Pencil, RotateCcw, X } from 'lucide-react';
import { formatCep, formatCnpj, formatDateTimeBR, formatPhone } from '@della/shared';
import { api, errorMessage } from '../../lib/api';
import { Alert, Button, Card, EmptyState, ErrorState, Field, KeyValue, Loading, Modal, PageHeader, Textarea } from '../../components/ui';
import { ClientStatusBadge } from '../../components/common';

type Decision = 'APPROVE' | 'RETURN' | 'REJECT';

/** Pendência cadastral: clientes cadastrados pelos vendedores aguardando aprovação (administrador e gestor). */
export default function Pending() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ id: string; name: string; decision: Decision } | null>(null);
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['clients-pending'], queryFn: () => api<{ items: any[]; total: number }>('/admin/clients-pending'), refetchInterval: 60_000 });
  const review = useMutation({
    mutationFn: () => api(`/admin/clients/${modal!.id}/review`, { body: { decision: modal!.decision, note: note || null } }),
    onSuccess: () => {
      toast.success(modal!.decision === 'APPROVE' ? 'Cadastro aprovado: o vendedor já pode fazer pedidos.' : modal!.decision === 'RETURN' ? 'Cadastro devolvido ao vendedor para correção.' : 'Cadastro recusado.');
      setModal(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['clients-pending'] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const open = (c: any, decision: Decision) => {
    setNote('');
    setModal({ id: c.id, name: c.tradeName ?? c.legalName, decision });
  };

  return (
    <>
      <PageHeader title="Pendência cadastral" subtitle="Clientes cadastrados pelos vendedores aguardando aprovação. Até aprovar, o vendedor só faz orçamentos para eles." />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.items.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma pendência" description="Quando um vendedor cadastrar um cliente, ele aparece aqui para aprovação." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data!.items.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-900">{c.tradeName ?? c.legalName}</p>
                  {c.tradeName && <p className="text-sm text-muted">{c.legalName}</p>}
                  <p className="text-sm tabular">CNPJ {formatCnpj(c.cnpj)}</p>
                </div>
                <ClientStatusBadge status={c.status} />
              </div>
              <div className="my-4 rounded-lg bg-slate-50 p-3">
                <KeyValue
                  items={[
                    ['Vendedor', c.salesRep?.fullName],
                    ['Enviado por', `${c.createdByName ?? '—'} em ${formatDateTimeBR(c.createdAt)}`],
                    ['Responsável', c.responsibleName],
                    ['Telefone', c.commercialPhone ? formatPhone(c.commercialPhone) : null],
                    ['E-mail', c.commercialEmail ?? c.financeEmail],
                    ['Inscrição estadual', c.stateRegistration],
                    ['Endereço', [[c.street, c.number].filter(Boolean).join(', '), c.district, [c.city, c.state].filter(Boolean).join('/'), c.cep && `CEP ${formatCep(c.cep)}`].filter(Boolean).join(' • ')],
                    ['Orçamentos feitos', c.quoteCount ? <span className="inline-flex items-center gap-1"><FileText className="size-3.5" /> {c.quoteCount}</span> : '0'],
                  ]}
                />
                {c.notes && <p className="mt-3 text-sm text-ink/80">Obs.: {c.notes}</p>}
              </div>
              {c.status === 'PENDING_REGISTRATION' && c.reviewNote && (
                <div className="mb-3">
                  <Alert tone="amber" title="Devolvido para correção">{c.reviewNote} (aguardando o vendedor corrigir)</Alert>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Button variant="success" icon={<Check className="size-4" />} onClick={() => open(c, 'APPROVE')} className="col-span-2 sm:col-span-1">Aprovar cadastro</Button>
                <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => open(c, 'RETURN')}>Pedir correção</Button>
                <Button variant="ghost" icon={<X className="size-4" />} onClick={() => open(c, 'REJECT')}>Recusar</Button>
                <Link to={`/admin/clientes/${c.id}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-navy-800 hover:bg-navy-50 sm:h-10">
                  <Pencil className="size-4" /> Editar dados
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        size="sm"
        title={modal?.decision === 'APPROVE' ? 'Aprovar cadastro' : modal?.decision === 'RETURN' ? 'Pedir correção ao vendedor' : 'Recusar cadastro'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancelar</Button>
            <Button variant={modal?.decision === 'APPROVE' ? 'success' : modal?.decision === 'REJECT' ? 'danger' : 'primary'} loading={review.isPending} onClick={() => review.mutate()}>
              Confirmar
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm">
          <strong>{modal?.name}</strong>
          {modal?.decision === 'APPROVE' && ' ficará ativo: o vendedor poderá fazer pedidos e transformar os orçamentos em pedido.'}
          {modal?.decision === 'RETURN' && ' volta para o vendedor corrigir. Ele continua podendo fazer orçamentos.'}
          {modal?.decision === 'REJECT' && ' será bloqueado: nem orçamentos nem pedidos.'}
        </p>
        <Field label={modal?.decision === 'APPROVE' ? 'Observação (opcional)' : 'Motivo (o vendedor verá)'}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={modal?.decision === 'RETURN' ? 'Ex.: falta a inscrição estadual' : ''} />
        </Field>
      </Modal>
    </>
  );
}
