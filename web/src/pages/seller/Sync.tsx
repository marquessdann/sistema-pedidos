import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ClipboardList, CloudOff, FileText, Pencil, RefreshCw, Trash2, UserPlus, Wifi } from 'lucide-react';
import { formatBRL, formatDateTimeBR } from '@della/shared';
import { acceptNewPrice, discardEntry, retryEntry, setForcedOffline, useOffline, type OutboxEntry } from '../../lib/offline';
import { runSync } from '../../components/OfflineBar';
import { Alert, Badge, Button, Card, CardTitle, EmptyState, PageHeader, Toggle, useConfirm } from '../../components/ui';

const KIND = {
  order: { label: 'Pedido', icon: <ClipboardList className="size-4" /> },
  quote: { label: 'Orçamento', icon: <FileText className="size-4" /> },
  client: { label: 'Cliente', icon: <UserPlus className="size-4" /> },
} as const;

/** Tela "Sincronizar": dados do aparelho, fila de envio e últimos enviados. */
export default function SyncPage() {
  const o = useOffline();
  const qc = useQueryClient();
  const nav = useNavigate();
  const confirm = useConfirm();

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
      title: `Excluir ${KIND[e.kind].label.toLowerCase()} não enviado?`,
      message: `“${e.label}” ainda não foi enviado ao sistema. Se excluir, ele será apagado deste aparelho.`,
      tone: 'danger',
      confirmLabel: 'Excluir',
    });
    if (ok) {
      await discardEntry(e.id);
      toast.success('Removido do aparelho.');
    }
  };

  const sync = async () => {
    if (o.forced) setForcedOffline(false);
    await runSync(qc);
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Sincronizar" subtitle="Trabalhe sem internet e envie tudo quando o sinal voltar." />

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className={o.offline ? 'flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-700' : 'flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700'}>
            {o.offline ? <CloudOff className="size-5" /> : <Wifi className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-navy-900">{o.offline ? (o.forced ? 'Modo sem internet ligado' : 'Sem internet no momento') : 'Conectado'}</p>
            <p className="text-sm text-muted">
              {o.snapshot
                ? `Dados no aparelho: ${o.snapshot.products} produtos e ${o.snapshot.clients} clientes • atualizados em ${formatDateTimeBR(o.snapshot.savedAt)}`
                : 'Ainda não há dados baixados neste aparelho.'}
            </p>
          </div>
          <Button size="lg" icon={<RefreshCw className={o.syncing || o.downloading ? 'size-5 animate-spin' : 'size-5'} />} loading={false} disabled={o.syncing || o.downloading || !o.online} onClick={sync}>
            {o.syncing ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <Toggle
            checked={o.forced}
            onChange={setForcedOffline}
            label="Trabalhar sem internet (sinal fraco)"
            description="Usa só os dados do aparelho, sem esperar a conexão. Pedidos e orçamentos ficam guardados até você sincronizar."
          />
        </div>
      </Card>

      {!o.snapshot && (
        <Alert tone="amber" title="Antes de ir para um lugar sem sinal">
          Com internet, toque em <strong>Sincronizar agora</strong>. Isso guarda no aparelho o catálogo, as fotos, os preços e os seus clientes.
        </Alert>
      )}

      <Card>
        <CardTitle>Aguardando envio {o.pending > 0 && <Badge tone="gold">{o.pending}</Badge>}</CardTitle>
        {o.outbox.length === 0 ? (
          <EmptyState title="Nada aguardando envio" description="Pedidos e orçamentos feitos sem internet aparecem aqui até serem sincronizados." icon={<CheckCircle2 className="size-6" />} />
        ) : (
          <ul className="divide-y divide-line">
            {o.outbox.map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-800">{KIND[e.kind].icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy-900">
                      {KIND[e.kind].label}
                      {e.action === 'DRAFT' && ' (rascunho)'}
                      {e.action === 'REQUEST_APPROVAL' && ' (vai para aprovação)'} • {e.label}
                    </p>
                    <p className="text-xs text-muted">
                      Feito em {formatDateTimeBR(e.createdAt)}
                      {e.totalCents !== undefined && ` • ${formatBRL(e.totalCents)}`}
                    </p>
                    {e.status === 'pending' && <Badge tone="blue" className="mt-1">Aguardando envio</Badge>}
                    {e.status === 'error' && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-red-700">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" /> {e.error}
                      </p>
                    )}
                    {e.status === 'review' && e.priceDiff && (
                      <p className="mt-1 text-xs text-amber-800">
                        Os preços mudaram desde o download: era {formatBRL(e.priceDiff.before)}, agora fica <strong>{formatBRL(e.priceDiff.after)}</strong>. Confirme para enviar com o valor atual.
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {e.status === 'review' && (
                    <Button size="sm" variant="gold" onClick={() => void acceptNewPrice(e.id).then(sync)}>
                      Enviar com o valor atual
                    </Button>
                  )}
                  {e.status === 'error' && (
                    <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} onClick={() => void retryEntry(e.id).then(sync)} disabled={!o.online}>
                      Tentar de novo
                    </Button>
                  )}
                  {e.wizard && (
                    <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => edit(e)}>
                      Abrir e corrigir
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void discard(e)}>
                    Excluir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {o.sent.length > 0 && (
        <Card>
          <CardTitle>Enviados recentemente</CardTitle>
          <ul className="divide-y divide-line">
            {o.sent.slice(0, 15).map((s) => (
              <li key={`${s.kind}:${s.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-navy-900">
                    {KIND[s.kind].label} {s.number ?? ''} • {s.label}
                  </p>
                  <p className="text-xs text-muted">
                    Enviado em {formatDateTimeBR(s.at)}
                    {s.totalCents !== undefined && ` • ${formatBRL(s.totalCents)}`}
                  </p>
                </div>
                {s.kind !== 'client' && (
                  <Button size="sm" variant="secondary" icon={<FileText className="size-4" />} onClick={() => nav(s.kind === 'order' ? `/vendedor/pedidos/${s.id}` : `/vendedor/orcamentos/${s.id}`)}>
                    Abrir / PDF
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>Como funciona</CardTitle>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>Com internet, toque em <strong>Sincronizar agora</strong> (o sistema também atualiza sozinho ao abrir).</li>
          <li>Sem sinal, abra o sistema pelo ícone da tela de início e faça pedidos e orçamentos normalmente. Ao salvar, eles ficam guardados aqui.</li>
          <li>Quando o sinal voltar, toque em <strong>Sincronizar</strong>: tudo é enviado, recebe número e o PDF pode ser gerado.</li>
          <li>Não saia da conta (botão “Sair”) enquanto estiver sem internet.</li>
        </ol>
      </Card>
    </div>
  );
}
