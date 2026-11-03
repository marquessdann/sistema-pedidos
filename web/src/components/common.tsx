import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Circle, CircleX, Download, Eye, FileText, Mail, MessageCircle, RefreshCw, Share2 } from 'lucide-react';
import { ORDER_STATUS_LABELS, ORDER_TIMELINE, formatDateTimeBR, whatsappLink, type OrderStatus } from '@della/shared';
import { api, errorMessage, fileUrl } from '../lib/api';
import { APPROVAL_TONE, CLIENT_TONE, ORDER_TONE, QUOTE_TONE, CLIENT_STATUS_LABELS, QUOTE_STATUS_LABELS } from '../lib/labels';
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Textarea, cx } from './ui';
import { APPROVAL_STATUS_LABELS } from '@della/shared';

export const OrderStatusBadge = ({ status }: { status: string }) => <Badge tone={ORDER_TONE[status]}>{ORDER_STATUS_LABELS[status as OrderStatus] ?? status}</Badge>;
export const QuoteStatusBadge = ({ status }: { status: string }) => <Badge tone={QUOTE_TONE[status]}>{QUOTE_STATUS_LABELS[status as keyof typeof QUOTE_STATUS_LABELS] ?? status}</Badge>;
export const ClientStatusBadge = ({ status }: { status: string }) => <Badge tone={CLIENT_TONE[status]}>{CLIENT_STATUS_LABELS[status as keyof typeof CLIENT_STATUS_LABELS] ?? status}</Badge>;
export const ApprovalBadge = ({ status }: { status: string }) =>
  status === 'NONE' ? null : <Badge tone={APPROVAL_TONE[status]}>Desconto: {APPROVAL_STATUS_LABELS[status as keyof typeof APPROVAL_STATUS_LABELS]}</Badge>;

export function ProductThumb({ fileName, alt, size = 'md' }: { fileName?: string | null; alt: string; size?: 'sm' | 'md' | 'lg' }) {
  const [err, setErr] = useState(false);
  const cls = size === 'sm' ? 'size-10' : size === 'lg' ? 'aspect-square w-full' : 'size-14';
  const src = fileUrl.product(fileName);
  if (!src || err) {
    return (
      <div className={cx(cls, 'flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-navy-50 to-gold-50 text-navy-300')} aria-label={alt}>
        <FileText className={size === 'lg' ? 'size-10' : 'size-5'} strokeWidth={1.4} />
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setErr(true)} className={cx(cls, 'shrink-0 rounded-lg border border-line bg-white object-contain')} />;
}

interface HistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
  user?: { name: string } | null;
}

/** Linha do tempo do processo do pedido. */
export function OrderTimeline({ status, history }: { status: string; history: HistoryEntry[] }) {
  const terminalBad = status === 'CANCELLED' || status === 'REJECTED';
  const reached = new Map<string, HistoryEntry>();
  for (const h of history) reached.set(h.toStatus, h);
  const currentIdx = ORDER_TIMELINE.indexOf(status as OrderStatus);
  const lastGoodIdx = terminalBad
    ? Math.max(...history.filter((h) => h.fromStatus).map((h) => ORDER_TIMELINE.indexOf(h.fromStatus as OrderStatus)), 0)
    : currentIdx;
  const steps = ORDER_TIMELINE.filter((s) => s !== 'PENDING_APPROVAL' || reached.has('PENDING_APPROVAL') || status === 'PENDING_APPROVAL');

  return (
    <div>
      {status === 'DRAFT' && <p className="mb-4 text-sm text-muted">Rascunho: o pedido ainda não foi confirmado.</p>}
      <ol className="relative space-y-0">
        {steps.map((s, i) => {
          const idx = ORDER_TIMELINE.indexOf(s);
          const done = status !== 'DRAFT' && idx <= lastGoodIdx;
          const current = s === status;
          const h = reached.get(s);
          return (
            <li key={s} className="relative flex gap-4 pb-6 last:pb-0">
              {i < steps.length - 1 && <span className={cx('absolute left-[13px] top-7 h-[calc(100%-20px)] w-0.5', done && idx < lastGoodIdx ? 'bg-gold-400' : 'bg-slate-200')} />}
              <span
                className={cx(
                  'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full',
                  current ? 'bg-navy-900 text-white ring-4 ring-navy-100' : done ? 'bg-gold-500 text-white' : 'bg-slate-100 text-slate-400',
                )}
              >
                {done && !current ? <CheckCircle2 className="size-4" /> : <Circle className={cx('size-3', current && 'fill-current')} />}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={cx('text-sm', current ? 'font-semibold text-navy-900' : done ? 'font-medium text-ink' : 'text-muted')}>{ORDER_STATUS_LABELS[s]}</p>
                {h && (
                  <p className="text-xs text-muted">
                    {formatDateTimeBR(h.createdAt)} {h.user?.name && `• ${h.user.name}`}
                    {h.note && <span className="mt-0.5 block text-ink/80">“{h.note}”</span>}
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {terminalBad && (
          <li className="relative flex gap-4">
            <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
              <CircleX className="size-4" />
            </span>
            <div className="pt-0.5">
              <p className="text-sm font-semibold text-red-700">{ORDER_STATUS_LABELS[status as OrderStatus]}</p>
              {reached.get(status) && (
                <p className="text-xs text-muted">
                  {formatDateTimeBR(reached.get(status)!.createdAt)} • {reached.get(status)!.user?.name}
                  {reached.get(status)!.note && <span className="mt-0.5 block text-ink/80">“{reached.get(status)!.note}”</span>}
                </p>
              )}
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}

export function StatusHistoryList({ history, labels }: { history: HistoryEntry[]; labels: Record<string, string> }) {
  return (
    <ul className="divide-y divide-line">
      {history.map((h) => (
        <li key={h.id} className="py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 text-ink">
            <span className="text-muted">{h.fromStatus ? labels[h.fromStatus] : 'Início'}</span>→<span className="font-medium">{labels[h.toStatus]}</span>
          </div>
          <p className="text-xs text-muted">
            {formatDateTimeBR(h.createdAt)} • {h.user?.name ?? 'Sistema'}
          </p>
          {h.note && <p className="mt-0.5 text-xs text-ink/80">{h.note}</p>}
        </li>
      ))}
    </ul>
  );
}

interface DocInfo {
  id: string;
  version: number;
  createdAt: string;
  sizeBytes: number;
  generatedBy?: { name: string };
}

/**
 * Ações de PDF: gerar / gerar novamente, visualizar, baixar, compartilhar, WhatsApp e e-mail.
 * Nunca afirma que o documento foi enviado: o WhatsApp abre com a mensagem pronta e o
 * usuário anexa o PDF manualmente (ou usa o compartilhamento nativo do aparelho).
 */
export function PdfActions({ kind, id, number, clientPhone, disabledReason }: { kind: 'orders' | 'quotes'; id: string; number?: string | null; clientPhone?: string | null; disabledReason?: string | null }) {
  const qc = useQueryClient();
  const [emailOpen, setEmailOpen] = useState(false);
  const docs = useQuery({ queryKey: ['docs', kind, id], queryFn: () => api<{ documents: DocInfo[]; shareMessage: string }>(`/documents/${kind}/${id}`) });
  const integrations = useQuery({ queryKey: ['integrations'], queryFn: () => api<{ email: boolean }>('/documents/integrations'), staleTime: 300_000 });
  const gen = useMutation({
    mutationFn: () => api(`/documents/${kind}/${id}`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('PDF gerado com sucesso.');
      void qc.invalidateQueries({ queryKey: ['docs', kind, id] });
    },
    onError: (e) => toast.error(errorMessage(e), { action: { label: 'Tentar novamente', onClick: () => gen.mutate() } }),
  });
  const latest = docs.data?.documents[0];
  const label = kind === 'orders' ? 'Pedido' : 'Orcamento';
  const fname = `${label}-${number ?? 'RASCUNHO'}.pdf`;

  // o PDF é baixado em segundo plano assim que existe: no celular, o compartilhamento precisa acontecer
  // no mesmo toque do usuário (sem esperar download), senão o navegador bloqueia
  const pdfBlob = useQuery({
    queryKey: ['pdf-blob', latest?.id],
    queryFn: async () => {
      const r = await fetch(fileUrl.doc(latest!.id), { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Não foi possível baixar o PDF.');
      return r.blob();
    },
    enabled: !!latest,
    staleTime: Infinity,
  });
  const message = docs.data?.shareMessage ?? '';
  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  const download = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  /** Envia pelo WhatsApp: no celular, com o arquivo PDF anexado; no computador, baixa o PDF e abre a conversa. */
  const sendWhatsApp = () => {
    if (!latest) {
      gen.mutate(undefined, { onSuccess: () => toast.info('PDF pronto. Toque de novo em “Enviar pelo WhatsApp”.', { duration: 6000 }) });
      return;
    }
    const blob = pdfBlob.data;
    if (!blob) {
      toast.info('Preparando o PDF… toque novamente em instantes.');
      return;
    }
    const file = new File([blob], fname, { type: 'application/pdf' });
    if (isTouch && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], text: message }).catch((e) => {
        if ((e as Error).name !== 'AbortError') toast.error('Não foi possível abrir o compartilhamento.');
      });
      return;
    }
    // computador (ou celular sem compartilhamento de arquivo): baixa o PDF e abre o WhatsApp com a mensagem
    download(blob);
    window.open(whatsappLink(message, clientPhone), '_blank', 'noopener');
    toast.info('PDF baixado e WhatsApp aberto com a mensagem. Arraste o arquivo baixado para a conversa para anexar.', { duration: 9000 });
  };

  const share = () => {
    const blob = pdfBlob.data;
    if (!blob) return toast.info('Preparando o PDF… tente em instantes.');
    const file = new File([blob], fname, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: fname, text: message }).catch((e) => {
        if ((e as Error).name !== 'AbortError') toast.error('Não foi possível compartilhar.');
      });
    } else {
      download(blob);
      toast.info('PDF baixado. Envie pelo aplicativo que preferir.');
    }
  };

  return (
    <Card>
      <CardTitle icon={<FileText className="size-4" />}>Documento PDF</CardTitle>
      {disabledReason ? (
        <p className="text-sm text-muted">{disabledReason}</p>
      ) : (
        <>
          <Button
            variant="success"
            size="lg"
            className="mb-3 w-full"
            icon={<MessageCircle className="size-5" />}
            loading={gen.isPending}
            onClick={sendWhatsApp}
          >
            Enviar pelo WhatsApp
          </Button>
          <div className="flex flex-wrap gap-2">
            {latest && (
              <>
                <a href={fileUrl.doc(latest.id)} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-navy-900 hover:bg-navy-50 sm:h-10">
                  <Eye className="size-4" /> Visualizar
                </a>
                <a href={fileUrl.doc(latest.id, true)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-medium text-navy-900 hover:bg-navy-50 sm:h-10">
                  <Download className="size-4" /> Baixar
                </a>
                <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={share}>
                  Compartilhar
                </Button>
                {integrations.data?.email && (
                  <Button variant="secondary" icon={<Mail className="size-4" />} onClick={() => setEmailOpen(true)}>
                    E-mail
                  </Button>
                )}
              </>
            )}
            <Button variant={latest ? 'ghost' : 'gold'} icon={latest ? <RefreshCw className="size-4" /> : <FileText className="size-4" />} loading={gen.isPending} onClick={() => gen.mutate()}>
              {latest ? 'Gerar novamente' : 'Gerar PDF'}
            </Button>
          </div>
          {latest ? (
            <p className="mt-3 text-xs text-muted">
              Versão {latest.version} gerada em {formatDateTimeBR(latest.createdAt)}
              {latest.generatedBy && ` por ${latest.generatedBy.name}`} • {(latest.sizeBytes / 1024).toFixed(0)} KB
              {docs.data!.documents.length > 1 && ` • ${docs.data!.documents.length} versões arquivadas`}
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted">Nenhum PDF gerado ainda.</p>
          )}
          <p className="mt-1 text-xs text-muted">
            {isTouch
              ? 'No celular, o PDF vai anexado: escolha o WhatsApp e o contato.'
              : 'No computador, o PDF é baixado e o WhatsApp abre com a mensagem pronta — arraste o arquivo para a conversa.'}
          </p>
        </>
      )}
      {latest && <EmailModal open={emailOpen} onClose={() => setEmailOpen(false)} docId={latest.id} defaultMessage={docs.data?.shareMessage ?? ''} />}
    </Card>
  );
}

function EmailModal({ open, onClose, docId, defaultMessage }: { open: boolean; onClose: () => void; docId: string; defaultMessage: string }) {
  const [to, setTo] = useState('');
  const [message, setMessage] = useState(defaultMessage);
  const send = useMutation({
    mutationFn: () => api(`/documents/file/${docId}/email`, { body: { to, message } }),
    onSuccess: () => {
      toast.success(`E-mail enviado para ${to}.`);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enviar PDF por e-mail"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={send.isPending} onClick={() => send.mutate()} disabled={!to}>
            Enviar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Destinatário" required>
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="cliente@empresa.com.br" />
        </Field>
        <Field label="Mensagem">
          <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
