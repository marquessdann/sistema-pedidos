/**
 * Importação de dados de cliente a partir de texto livre (ex.: mensagem recebida pelo WhatsApp).
 * Identifica campos por rótulos ("CNPJ:", "Razão social -", etc.) e por padrões (CNPJ, CEP, e-mail, telefone).
 * O resultado é apenas uma SUGESTÃO: o administrador revisa tudo antes de salvar.
 */
import { formatCep, formatCnpj, formatPhone, normalizeCnpj, onlyDigits, UFS } from './documents';

export interface ParsedClient {
  legalName?: string;
  tradeName?: string;
  cnpj?: string;
  stateRegistration?: string;
  responsibleName?: string;
  financeEmail?: string;
  financePhone?: string;
  commercialEmail?: string;
  commercialPhone?: string;
  cep?: string;
  state?: string;
  city?: string;
  district?: string;
  street?: string;
  number?: string;
  complement?: string;
  notes?: string;
}

type Field = keyof ParsedClient;

const LABELS: [RegExp, Field][] = [
  [/^raz[aã]o\s*social|^nome\s*empresarial|^empresa$/, 'legalName'],
  [/^nome\s*fantasia|^fantasia/, 'tradeName'],
  [/^cnpj/, 'cnpj'],
  [/^(inscri[cç][aã]o\s*estadual|i\.?\s*e\.?$|ie$)/, 'stateRegistration'],
  [/^(nome\s*do\s*)?respons[aá]vel|^contato$|^comprador|^propriet[aá]rio/, 'responsibleName'],
  [/^e-?mail\s*(do\s*)?financeiro|^e-?mail\s*fin/, 'financeEmail'],
  [/^(telefone|tel|fone|whats(app)?|celular)\s*(do\s*)?financeiro/, 'financePhone'],
  [/^e-?mail\s*(do\s*)?comercial|^e-?mail$/, 'commercialEmail'],
  [/^(telefone|tel|fone|whats(app)?|celular)\s*(do\s*)?comercial|^(telefone|tel|fone|whats(app)?|celular)$/, 'commercialPhone'],
  [/^cep/, 'cep'],
  [/^(estado|uf)$/, 'state'],
  [/^(cidade|munic[ií]pio)/, 'city'],
  [/^bairro/, 'district'],
  [/^(endere[cç]o|logradouro|rua|av(enida)?)$/, 'street'],
  [/^(n[uú]mero|n[º°o]\.?|num\.?)$/, 'number'],
  [/^complemento/, 'complement'],
  [/^(obs|observa[cç](ão|ao|ões|oes))/, 'notes'],
];

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CNPJ_RE = /\b[0-9A-Za-z]{2}\.?[0-9A-Za-z]{3}\.?[0-9A-Za-z]{3}\/?[0-9A-Za-z]{4}-?\d{2}\b/;
const CEP_RE = /\b\d{5}-?\d{3}\b/;
const PHONE_RE = /(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/;

export function parseClientText(text: string): { data: ParsedClient; unrecognized: string[] } {
  const data: ParsedClient = {};
  const unrecognized: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-•*>]+/, '').trim())
    .filter(Boolean);

  for (const line of lines) {
    const m = line.match(/^(.{2,40}?)\s*(?::|=|\s[-–]\s)\s*(.+)$/);
    let assigned = false;
    if (m) {
      const label = normalizeLabel(m[1]);
      const value = m[2].trim().replace(/^\*+|\*+$/g, '').trim();
      for (const [re, field] of LABELS) {
        if (re.test(label) && value && !data[field]) {
          data[field] = value;
          assigned = true;
          break;
        }
      }
    }
    if (assigned) continue;

    // Sem rótulo reconhecido: tenta detectar por padrão.
    const email = line.match(EMAIL_RE)?.[0];
    const cnpj = line.match(CNPJ_RE)?.[0];
    const cep = line.match(CEP_RE)?.[0];
    if (cnpj && !data.cnpj && normalizeCnpj(cnpj).length === 14 && /\d{2}$/.test(cnpj)) {
      data.cnpj = cnpj;
    } else if (email) {
      if (/financ/i.test(line) && !data.financeEmail) data.financeEmail = email;
      else if (!data.commercialEmail) data.commercialEmail = email;
      else if (!data.financeEmail) data.financeEmail = email;
      else unrecognized.push(line);
    } else if (cep && !data.cep && /cep/i.test(line)) {
      data.cep = cep;
    } else if (PHONE_RE.test(line) && onlyDigits(line).length >= 10 && onlyDigits(line).length <= 13) {
      if (/financ/i.test(line) && !data.financePhone) data.financePhone = line;
      else if (!data.commercialPhone) data.commercialPhone = line;
      else if (!data.financePhone) data.financePhone = line;
      else unrecognized.push(line);
    } else {
      unrecognized.push(line);
    }
  }

  // "Cidade/UF" ou "Cidade - UF"
  if (data.city && !data.state) {
    const cm = data.city.match(/^(.+?)\s*[/\-–]\s*([A-Za-z]{2})$/);
    if (cm && (UFS as readonly string[]).includes(cm[2].toUpperCase())) {
      data.city = cm[1].trim();
      data.state = cm[2].toUpperCase();
    }
  }
  if (data.state) {
    const uf = data.state.trim().toUpperCase();
    data.state = (UFS as readonly string[]).includes(uf) ? uf : data.state;
  }
  // "Rua X, 123 - Sala 4"
  if (data.street && !data.number) {
    const sm = data.street.match(/^(.+?),\s*(\d+[A-Za-z]?|s\/?n)\s*(?:[-–,]\s*(.+))?$/i);
    if (sm) {
      data.street = sm[1].trim();
      data.number = sm[2].trim();
      if (sm[3] && !data.complement) data.complement = sm[3].trim();
    }
  }
  if (data.cnpj) {
    const cnpjMatch = data.cnpj.match(CNPJ_RE)?.[0] ?? data.cnpj;
    data.cnpj = formatCnpj(cnpjMatch);
  }
  if (data.cep) data.cep = formatCep(data.cep);
  if (data.commercialPhone) data.commercialPhone = formatPhone(data.commercialPhone.match(PHONE_RE)?.[0] ?? data.commercialPhone);
  if (data.financePhone) data.financePhone = formatPhone(data.financePhone.match(PHONE_RE)?.[0] ?? data.financePhone);
  for (const f of ['financeEmail', 'commercialEmail'] as const) {
    if (data[f]) data[f] = data[f]!.match(EMAIL_RE)?.[0]?.toLowerCase() ?? data[f];
  }
  return { data, unrecognized };
}
