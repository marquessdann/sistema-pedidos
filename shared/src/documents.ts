/**
 * Validação e máscaras de documentos brasileiros.
 * O CNPJ suporta o formato numérico tradicional e o formato alfanumérico
 * (IN RFB nº 2.229/2024, vigente a partir de julho/2026): 12 caracteres [0-9A-Z] + 2 dígitos verificadores numéricos.
 */

export function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/** Normaliza CNPJ: remove pontuação e coloca letras em maiúsculas. */
export function normalizeCnpj(v: string | null | undefined): string {
  return (v ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function cnpjCharValue(c: string): number {
  return c.charCodeAt(0) - 48; // '0'..'9' => 0..9, 'A'..'Z' => 17..42
}

function cnpjDv(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = base.split('').reduce((acc, c, i) => acc + cnpjCharValue(c) * weights[i], 0);
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const v = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(v)) return false;
  if (/^(\d)\1{13}$/.test(v)) return false;
  const d1 = cnpjDv(v.slice(0, 12));
  const d2 = cnpjDv(v.slice(0, 12) + d1);
  return v.endsWith(`${d1}${d2}`);
}

export function formatCnpj(value: string | null | undefined): string {
  const v = normalizeCnpj(value).slice(0, 14);
  return v
    .replace(/^(\w{2})(\w)/, '$1.$2')
    .replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3')
    .replace(/\.(\w{3})(\w)/, '.$1/$2')
    .replace(/(\w{4})(\w)/, '$1-$2');
}

export function isValidCpf(value: string | null | undefined): boolean {
  const v = onlyDigits(value);
  if (v.length !== 11 || /^(\d)\1{10}$/.test(v)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(v[i], 10) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(v[9], 10) && calc(10) === parseInt(v[10], 10);
}

export function formatCpf(value: string | null | undefined): string {
  const v = onlyDigits(value).slice(0, 11);
  return v
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

export function formatPhone(value: string | null | undefined): string {
  let v = onlyDigits(value);
  if (v.startsWith('55') && v.length > 11) v = v.slice(2);
  v = v.slice(0, 11);
  if (v.length <= 2) return v.length ? `(${v}` : '';
  if (v.length <= 6) return `(${v.slice(0, 2)}) ${v.slice(2)}`;
  if (v.length <= 10) return `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
  return `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
}

export function isValidPhone(value: string | null | undefined): boolean {
  const v = onlyDigits(value);
  return v.length === 10 || v.length === 11;
}

export function formatCep(value: string | null | undefined): string {
  const v = onlyDigits(value).slice(0, 8);
  return v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v;
}

export function isValidCep(value: string | null | undefined): boolean {
  return onlyDigits(value).length === 8;
}

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

/** Gera link do WhatsApp (wa.me) com mensagem pronta. Não envia nada automaticamente. */
export function whatsappLink(message: string, phone?: string | null): string {
  let digits = onlyDigits(phone);
  if (digits && digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
