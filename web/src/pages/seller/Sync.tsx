import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ClipboardList, CloudOff, FileText, Pencil, RefreshCw, Smartphone, Trash2, UserPlus } from 'lucide-react';
import { formatBRL, formatDateTimeBR } from '@della/shared';
import { acceptNewPrice, discardEntry, retryEntry, useOffline, type OutboxEntry } from '../../lib/offline';
import { runSync } from '../../components/OfflineBar';
import { Button, Card, CardTitle, cx, useConfirm } from '../../components/ui';

const KIND = {
  order: { label: 'Pedido', icon: <ClipboardList className="size-5" /> },
  quote: { label: 'Orçamento', icon: <FileText className="size-5" /> },
  client: { label: 'Cliente novo', icon: <UserPlus className="size-5" /> },
} as const;

/**
 * Tela "Enviar pedidos" — feita para ser simples:
 * um aviso grande (tudo enviado / guardados no celular / sem internet) e um único botão.
 * Baixar dados e enviar a fila acontecem sozinhos; o botão é só para quando o vendedor quiser forçar.
 */
export default function SyncPage() {
  const o = useOffline();
  const qc = useQueryClient();
  const nav = useNavigate();
  const confirm = useConfirm();
  const busy = o.syncing || o.downloading;
  const problems = o.outbox.filter((e) => e.status !== 'pending');

  const edit = (e: OutboxEntry) => {
    if (!e.wizard) return;
    const { mode, state } = e.wizard;
    try {
      sessionStorage.setItem(`della:wizard3:${mode}:${state.clientId}`, JSON.stringify({ ...state, step: 1 }));
    } catch {
      /* ignore */
    }
    nav(`/vendedor/${mode === 'order' ? 'novo-pedido' : 'novo-orcamento'}?cliente=${state.clientId}`);
  };

  const discard = async (e: OutboxEntry) => {
    const ok = await confirm({
      title: `Apagar este ${KIND[e.kind].label.toLowerCase()}?`,
      message: `“${e.label}” ainda não foi enviado. Se apagar, ele some do celular.`,
      tone: 'danger',
      confirmLabel: 'Apagar',
    });
    if (ok) {
      await discardEntry(e.id);
      toast.success('Apagado.');
    }
  };

  const send = () =>
    void runSync(qc).then((r) => {
      if (r && !r.offline && !r.sent && !r.review && !r.errors) toast.success('Produtos e clientes atualizados.');
    });

  // ---------- aviso principal ----------
  const status = !o.online
    ? {
        tone: 'amber' as const,
        icon: <CloudOff className="size-9" />,
        title: 'Sem internet',
        text: o.pending
          ? `${o.pending} ${o.pending === 1 ? 'item guardado' : 'itens guardados'} no celular. Pode continuar trabalhando: quando a internet voltar, o envio é automático.`
          : 'Pode continuar fazendo pedidos normalmente. Eles ficam guardados no celular e são enviados quando a internet voltar.',
      }
    : o.pending
      ? {
          tone: 'blue' as const,
          icon: <Smartphone className="size-9" />,
          title: `${o.pending} ${o.pending === 1 ? 'item guardado' : 'itens guardados'} no celular`,
          text: 'Toque no botão abaixo para enviar agora.',
        }
      : {
          tone: 'green' as const,
          icon: <CheckCircle2 className="size-9" />,
          title: 'Tudo enviado',
          text: 'Nada pendente. O celular está pronto para trabalhar mesmo sem internet.',
        };
  const toneCls = { amber: 'bg-amber-50 text-amber-700', blue: 'bg-sky-50 text-sky-700', green: 'bg-emerald-50 text-emerald-700' }[status.tone];

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold text-navy-900">Enviar pedidos</h1>

      <Card>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className={cx('flex size-16 items-center justify-center rounded-full', toneCls)}>{status.icon}</div>
          <p className="text-xl font-semibold text-navy-900">{status.title}</p>
          <p className="text-base leading-relaxed text-slate-600">{status.text}</p>
          <Button size="lg" className="mt-2 w-full text-lg" icon={<RefreshCw className={busy ? 'size-5 animate-spin' : 'size-5'} />} disabled={busy || !o.online} onClick={send}>
            {busy ? 'Enviando…' : o.pending ? 'Enviar agora' : 'Atualizar produtos e clientes'}
          </Button>
          {o.snapshot && <p className="text-sm text-muted">Última atualização: {formatDateTimeBR(o.snapshot.savedAt)}</p>}
        </div>
      </Card>

      {o.outbox.length > 0 && (
        <Card>
          <CardTitle>Guardados no celular</CardTitle>
          <ul className="divide-y divide-line">
            {o.outbox.map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-800">{KIND[e.kind].icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-medium text-navy-900">
                      {KIND[e.kind].label} • {e.label}
                    </p>
                    <p className="text-sm text-muted">
                      {formatDateTimeBR(e.createdAt)}
                      {e.totalCents !== undefined && ` • ${formatBRL(e.totalCents)}`}
                    </p>
                    {e.status === 'error' && (
                      <p className="mt-1 flex items-start gap-1 text-sm text-red-700">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {e.error}
                      </p>
                    )}
                    {e.status === 'review' && e.priceDiff && (
                      <p className="mt-1 text-sm text-amber-800">
                        O preço mudou: era {formatBRL(e.priceDiff.before)}, agora é <strong>{formatBRL(e.priceDiff.after)}</strong>.
                      </p>
                    )}
                  </div>
                </div>
                {e.status !== 'pending' && (
                  <div className="mt-2 grid gap-2 sm:flex sm:justify-end">
                    {e.status === 'review' && (
                      <Button variant="gold" onClick={() => void acceptNewPrice(e.id).then(send)}>
                        Enviar com o preço novo
                      </Button>
                    )}
                    {e.status === 'error' && (
                      <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void retryEntry(e.id).then(send)} disabled={!o.online}>
                        Tentar de novo
                      </Button>
                    )}
                    {e.wizard && (
                      <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => edit(e)}>
                        Corrigir
                      </Button>
                    )}
                    <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void discard(e)}>
                      Apagar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {problems.length > 0 && <p className="mt-2 text-sm text-muted">Os itens com aviso precisam de atenção antes de serem enviados.</p>}
        </Card>
      )}

      {o.sent.length > 0 && (
        <Card>
          <CardTitle>Enviados</CardTitle>
          <ul className="divide-y divide-line">
            {o.sent.slice(0, 10).map((s) => (
              <li key={`${s.kind}:${s.id}`} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-medium text-navy-900">
                    {KIND[s.kind].label} {s.number ?? ''}
                  </p>
                  <p className="truncate text-sm text-muted">{s.label}</p>
                </div>
                {s.kind !== 'client' && (
                  <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => nav(s.kind === 'order' ? `/vendedor/pedidos/${s.id}` : `/vendedor/orcamentos/${s.id}`)}>
                    Abrir
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>Como usar sem internet</CardTitle>
        <ol className="list-decimal space-y-2 pl-5 text-base text-slate-700">
          <li>Abra o sistema pelo <strong>ícone da Della</strong> na tela do celular.</li>
          <li>Faça os pedidos normalmente, mesmo sem sinal. Eles ficam guardados no celular.</li>
          <li>Quando a internet voltar, eles são <strong>enviados sozinhos</strong>.</li>
          <li>
            <strong>Não toque em “Sair”</strong> da conta sem internet.
          </li>
        </ol>
      </Card>
    </div>
  );
}
