/**
 * Utilitários monetários.
 *
 * Todos os valores monetários do sistema são inteiros em CENTAVOS.
 * Todos os percentuais são inteiros em PONTOS-BASE (bps): 1% = 100 bps, 100% = 10000 bps.
 * Isso evita erros de ponto flutuante em somas, descontos e tributos.
 */

export const BPS_100_PERCENT = 10_000;

/** Multiplica um valor em centavos por um percentual em bps, arredondando meio-para-cima (half-up). */
export function mulBps(cents: number, bps: number): number {
  assertInt(cents, 'cents');
  assertInt(bps, 'bps');
  const negative = cents < 0 !== bps < 0 && cents !== 0 && bps !== 0;
  const a = BigInt(Math.abs(cents)) * BigInt(Math.abs(bps));
  const q = (a + 5000n) / 10000n;
  const result = Number(q);
  return negative ? -result : result;
}

/** Calcula quantos bps `part` representa de `whole`, arredondado (half-up). */
export function ratioBps(part: number, whole: number): number {
  if (whole <= 0) return 0;
  const a = BigInt(part) * 10000n;
  const w = BigInt(whole);
  return Number((a * 2n + w) / (w * 2n));
}

export function assertInt(n: number, name = 'valor'): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${name} deve ser um inteiro seguro (recebido: ${n})`);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 123456 -> "R$ 1.234,56" (usa espaço normal para facilitar PDFs e mensagens). */
export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  return brl.format(cents / 100).replace(/ /g, ' ');
}

/** 550 -> "5,50%" */
export function formatBps(bps: number | null | undefined, decimals = 2): string {
  if (bps === null || bps === undefined) return '—';
  return (
    (bps / 100).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%'
  );
}

/** "5,5" | "5.5" | "5" -> 550 bps. Retorna null quando inválido. */
export function parsePercentToBps(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  const s = input.trim().replace('%', '').replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/** "1.234,56" | "1234,56" | "1234.56" | "R$ 10" -> centavos. Retorna null quando inválido. */
export function parseBRLToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = input.trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  if (s === '') return null;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [int, dec = ''] = s.replace('-', '').split('.');
  const cents = parseInt(int, 10) * 100 + parseInt((dec + '00').slice(0, 2), 10);
  return s.startsWith('-') ? -cents : cents;
}

/** Centavos -> "1234,56" (para preencher inputs editáveis). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Bps -> "5,5" (para preencher inputs editáveis). */
export function bpsToInput(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '';
  return String(bps / 100).replace('.', ',');
}
