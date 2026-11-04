import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidCnpj, normalizeCnpj, onlyDigits } from '@della/shared';
import { requireAuth } from '../../lib/auth';
import { AppError } from '../../lib/errors';
import { isTest } from '../../config';

/**
 * Consulta de CNPJ em bases públicas e gratuitas da Receita Federal.
 * Tenta, em ordem: BrasilAPI, CNPJá (API aberta) e ReceitaWS — a primeira que responder vence.
 * Inscrição Estadual NÃO vem da Receita (é estadual/Sintegra): continua sendo digitada.
 */
export interface CnpjData {
  cnpj: string;
  legalName: string | null;
  tradeName: string | null;
  /** Situação cadastral na Receita (ex.: ATIVA, BAIXADA, INAPTA) */
  status: string | null;
  statusOk: boolean;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
  phone: string | null;
  email: string | null;
  mainActivity: string | null;
  source: string;
}

type Provider = { name: string; url: (cnpj: string) => string; map: (j: any, cnpj: string) => CnpjData | null };

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** "RUA ASSIS FIGUEIREDO" → "Rua Assis Figueiredo" (mantém siglas curtas como "de", "da"). */
export function titleCase(v: string | null): string | null {
  if (!v) return v;
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return v
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function phoneDigits(v: unknown): string | null {
  const d = onlyDigits(typeof v === 'string' ? v.split('/')[0] : String(v ?? ''));
  return d.length >= 10 && d.length <= 11 ? d : null;
}

function finish(d: Omit<CnpjData, 'statusOk'>): CnpjData {
  const status = d.status ? d.status.toUpperCase() : null;
  return { ...d, status, statusOk: status === 'ATIVA' };
}

export const providers: Provider[] = [
  {
    name: 'BrasilAPI',
    url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`,
    map: (j, cnpj) => {
      if (!j || !j.razao_social) return null;
      const tipo = str(j.descricao_tipo_de_logradouro);
      const logr = str(j.logradouro);
      const street = logr ? (tipo && !logr.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${logr}` : logr) : null;
      return finish({
        cnpj,
        legalName: str(j.razao_social),
        tradeName: str(j.nome_fantasia),
        status: str(j.descricao_situacao_cadastral),
        street: titleCase(street),
        number: str(j.numero),
        complement: titleCase(str(j.complemento)),
        district: titleCase(str(j.bairro)),
        city: titleCase(str(j.municipio)),
        state: str(j.uf)?.toUpperCase() ?? null,
        cep: onlyDigits(j.cep) || null,
        phone: phoneDigits(j.ddd_telefone_1) ?? phoneDigits(j.ddd_telefone_2),
        email: str(j.email)?.toLowerCase() ?? null,
        mainActivity: str(j.cnae_fiscal_descricao),
        source: 'BrasilAPI',
      });
    },
  },
  {
    name: 'CNPJá',
    url: (c) => `https://open.cnpja.com/office/${c}`,
    map: (j, cnpj) => {
      if (!j || !j.company?.name) return null;
      const a = j.address ?? {};
      const p = Array.isArray(j.phones) && j.phones[0] ? `${j.phones[0].area ?? ''}${j.phones[0].number ?? ''}` : null;
      return finish({
        cnpj,
        legalName: str(j.company.name),
        tradeName: str(j.alias),
        status: str(j.status?.text),
        street: titleCase(str(a.street)),
        number: str(a.number),
        complement: titleCase(str(a.details)),
        district: titleCase(str(a.district)),
        city: titleCase(str(a.city)),
        state: str(a.state)?.toUpperCase() ?? null,
        cep: onlyDigits(a.zip) || null,
        phone: phoneDigits(p),
        email: Array.isArray(j.emails) && j.emails[0]?.address ? String(j.emails[0].address).toLowerCase() : null,
        mainActivity: str(j.mainActivity?.text),
        source: 'CNPJá',
      });
    },
  },
  {
    name: 'ReceitaWS',
    url: (c) => `https://receitaws.com.br/v1/cnpj/${c}`,
    map: (j, cnpj) => {
      if (!j || j.status === 'ERROR' || !j.nome) return null;
      return finish({
        cnpj,
        legalName: str(j.nome),
        tradeName: str(j.fantasia),
        status: str(j.situacao),
        street: titleCase(str(j.logradouro)),
        number: str(j.numero),
        complement: titleCase(str(j.complemento)),
        district: titleCase(str(j.bairro)),
        city: titleCase(str(j.municipio)),
        state: str(j.uf)?.toUpperCase() ?? null,
        cep: onlyDigits(j.cep) || null,
        phone: phoneDigits(j.telefone),
        email: str(j.email)?.toLowerCase() ?? null,
        mainActivity: Array.isArray(j.atividade_principal) ? str(j.atividade_principal[0]?.text) : null,
        source: 'ReceitaWS',
      });
    },
  },
];

const cache = new Map<string, { at: number; data: CnpjData | null }>();
const CACHE_MS = 24 * 3600_000;

export async function lookupCnpj(cnpjRaw: string, fetchImpl: typeof fetch = fetch): Promise<CnpjData | null> {
  const cnpj = normalizeCnpj(cnpjRaw);
  const hit = cache.get(cnpj);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  let anyAnswered = false;
  for (const p of providers) {
    try {
      const res = await fetchImpl(p.url(cnpj), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (res.status === 404 || res.status === 400) {
        anyAnswered = true;
        continue;
      }
      if (!res.ok) continue;
      const data = p.map(await res.json(), cnpj);
      if (data) {
        cache.set(cnpj, { at: Date.now(), data });
        return data;
      }
      anyAnswered = true;
    } catch {
      /* fonte fora do ar: tenta a próxima */
    }
  }
  if (anyAnswered) {
    cache.set(cnpj, { at: Date.now(), data: null });
    return null;
  }
  throw new AppError(503, 'A consulta de CNPJ está indisponível no momento. Preencha os dados manualmente.', 'CNPJ_LOOKUP_UNAVAILABLE');
}

export function clearCnpjCache() {
  cache.clear();
}

export async function cnpjRoutes(app: FastifyInstance) {
  app.get(
    '/:cnpj',
    { preHandler: requireAuth, config: { rateLimit: { max: isTest ? 10_000 : 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { cnpj } = z.object({ cnpj: z.string().max(20) }).parse(req.params);
      if (!isValidCnpj(cnpj)) throw new AppError(400, 'CNPJ inválido. Confira os dígitos.', 'INVALID_CNPJ');
      const data = await lookupCnpj(cnpj);
      if (!data) throw new AppError(404, 'CNPJ não encontrado na base da Receita Federal.', 'CNPJ_NOT_FOUND');
      return data;
    },
  );
}
