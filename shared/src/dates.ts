/** Datas no fuso da empresa (padrão America/Sao_Paulo) e formatação brasileira. */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Retorna a data local (YYYY-MM-DD) no fuso informado. */
export function todayInTz(tz = DEFAULT_TIMEZONE, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}

/** "2026-11-02" | Date -> "02/11/2026" */
export function formatDateBR(value: string | Date | null | undefined, tz = DEFAULT_TIMEZONE): string {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

/** Data e hora no padrão brasileiro: "02/11/2026 14:35" */
export function formatDateTimeBR(value: string | Date | null | undefined, tz = DEFAULT_TIMEZONE): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace(',', '');
}

/** Soma dias a uma data YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Converte uma data local YYYY-MM-DD (início do dia no fuso) para instante UTC. */
export function startOfDayInTz(isoDate: string, tz = DEFAULT_TIMEZONE): Date {
  // calcula o deslocamento do fuso naquele dia
  const guess = new Date(`${isoDate}T00:00:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offset = utc.getTime() - local.getTime();
  return new Date(guess.getTime() + offset);
}
