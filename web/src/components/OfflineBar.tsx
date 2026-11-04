import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CloudOff, RefreshCw, UploadCloud } from 'lucide-react';
import { formatDateTimeBR } from '@della/shared';
import { downloadSnapshot, isForcedOffline, listOutbox, loadSnapshot, syncNow, useOffline, type SyncResult } from '../lib/offline';
import { errorMessage } from '../lib/api';
import { Button } from './ui';

/** Mensagem do resultado da sincronização. */
export function syncToast(r: SyncResult) {
  if (r.offline) return toast.error('Sem internet agora. Tudo continua guardado no aparelho; tente de novo quando tiver sinal.');
  const parts: string[] = [];
  if (r.sent) parts.push(`${r.sent} enviado(s)`);
  if (r.review) parts.push(`${r.review} com preço alterado (confira)`);
  if (r.errors) parts.push(`${r.errors} com problema (confira)`);
  if (r.review || r.errors) toast.warning(`Sincronizado: ${parts.join(', ')}.`, { duration: 8000 });
  else toast.success(r.sent ? `Sincronizado: ${parts.join(', ')}. Dados atualizados.` : 'Dados atualizados. Pronto para usar sem internet.');
}

export async function runSync(qc?: ReturnType<typeof useQueryClient>) {
  try {
    const r = await syncNow();
    syncToast(r);
    if (qc && !r.offline) void qc.invalidateQueries();
    return r;
  } catch (e) {
    toast.error(errorMessage(e));
    return null;
  }
}

/**
 * Faixa do vendedor: avisa quando está sem internet e quantos itens aguardam envio, com o botão "Sincronizar".
 * Também baixa os dados automaticamente (primeiro acesso / dados antigos) e envia a fila quando o sinal volta.
 */
export function OfflineBar() {
  const o = useOffline();
  const nav = useNavigate();
  const qc = useQueryClient();
  const started = useRef(false);

  // primeiro acesso com internet: baixa os dados; com fila pendente, envia
  useEffect(() => {
    if (started.current || o.offline) return;
    started.current = true;
    void (async () => {
      const snap = await loadSnapshot();
      const old = !snap || Date.now() - new Date(snap.savedAt).getTime() > 6 * 3600_000;
      if ((await listOutbox()).length > 0) await runSync(qc);
      else if (old) await downloadSnapshot().catch(() => undefined);
    })();
  }, [o.offline, qc]);

  // sinal voltou: envia automaticamente o que ficou guardado
  useEffect(() => {
    const onOnline = () => {
      void (async () => {
        if (!isForcedOffline() && (await listOutbox()).length) await runSync(qc);
      })();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [qc]);

  if (!o.offline && o.pending === 0) return null;
  return (
    <div className={o.offline ? 'border-b border-amber-200 bg-amber-50' : 'border-b border-sky-200 bg-sky-50'}>
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2 lg:px-8">
        {o.offline ? <CloudOff className="size-5 shrink-0 text-amber-700" /> : <UploadCloud className="size-5 shrink-0 text-sky-700" />}
        <button type="button" className="min-w-0 flex-1 text-left text-xs leading-snug" onClick={() => nav('/vendedor/sincronizar')}>
          <span className="block font-semibold text-navy-900">
            {o.offline ? (o.forced ? 'Modo sem internet ligado' : 'Sem internet') : 'Itens aguardando envio'}
            {o.pending > 0 && ` • ${o.pending} aguardando envio`}
          </span>
          <span className="block truncate text-muted">
            {o.snapshot ? `Dados do aparelho de ${formatDateTimeBR(o.snapshot.savedAt).replace(/\/\d{4}/, '')}` : 'Sem dados baixados: sincronize quando tiver internet.'}
          </span>
        </button>
        <Button
          size="sm"
          variant={o.offline ? 'secondary' : 'primary'}
          icon={<RefreshCw className={o.syncing ? 'size-4 animate-spin' : 'size-4'} />}
          disabled={o.syncing || (!o.online && !o.forced)}
          onClick={() => (o.forced ? nav('/vendedor/sincronizar') : void runSync(qc))}
        >
          Sincronizar
        </Button>
      </div>
    </div>
  );
}
