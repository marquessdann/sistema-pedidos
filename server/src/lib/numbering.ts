import type { Tx } from '../db';

/**
 * Próximo número de documento, atômico e sem duplicação (INSERT ... ON CONFLICT ... RETURNING).
 * Formato: PREFIXO-AAAA-000001. A sequência reinicia a cada ano.
 */
export async function nextDocumentNumber(tx: Tx, prefix: string, year: number): Promise<string> {
  const key = `${prefix}-${year}`;
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO number_sequences (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = number_sequences.value + 1
    RETURNING value`;
  const value = Number(rows[0].value);
  return `${key}-${String(value).padStart(6, '0')}`;
}
