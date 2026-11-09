import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CloudOff, RefreshCw, UploadCloud } from 'lucide-react';
import { downloadSnapshot, listOutbox, loadSnapshot, syncNow, useOffline, type SyncResult } from '../lib/offline';
import { errorMessage } from '../lib/api';

/** Mensagem do resultado da sincronização. */
export function syncToast(r: SyncResult) {
  if (r.offline) return toast.error('Sem internet agora. Os pedidos continuam guardados no celular.');
  const parts: string[] = [];
  if (r.sent) parts.push(`${r.sent} enviado(s)`);
  if (r.review) parts.push(`${r.review} com preço alterado (confira)`);
  if (r.errors) parts.push(`${r.errors} com problema (confira)`);
  if (r.review || r.errors) toast.warning(`Enviado: ${parts.join(', ')}. Veja em “Enviar pedidos”.`, { duration: 8000 });
  else if (r.sent) toast.success(`Pronto! ${parts.join(', ')}.`);
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
        if ((await listOutbox()).length) await runSync(qc);
      })();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [qc]);

  if (!o.offline && o.pending === 0) return null;
  const n = o.pending;
  const itens = `${n} ${n === 1 ? 'item guardado' : 'itens guardados'} no celular`;
  return (
    <button
      type="button"
      onClick={() => nav('/vendedor/sincronizar')}
      className={o.offline ? 'block w-full border-b border-amber-200 bg-amber-50 text-left' : 'block w-full border-b border-sky-200 bg-sky-50 text-left'}
    >
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5 lg:px-8">
        {o.offline ? <CloudOff className="size-6 shrink-0 text-amber-700" /> : <UploadCloud className="size-6 shrink-0 text-sky-700" />}
        <span className="min-w-0 flex-1 text-sm leading-snug">
          <span className="block font-semibold text-navy-900">
            {o.offline ? 'Sem internet — pode continuar trabalhando' : o.syncing ? 'Enviando…' : itens}
          </span>
          <span className="block text-slate-600">
            {o.offline ? (n ? `${itens}. Serão enviados quando a internet voltar.` : 'Os pedidos ficam guardados no celular.') : 'Toque aqui para enviar.'}
          </span>
        </span>
        {!o.offline && <RefreshCw className={o.syncing ? 'size-5 shrink-0 animate-spin text-sky-700' : 'size-5 shrink-0 text-sky-700'} />}
      </div>
    </button>
  );
}
