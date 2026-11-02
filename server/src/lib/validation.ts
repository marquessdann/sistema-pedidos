import { z } from 'zod';
import { isValidCnpj, isValidCpf, normalizeCnpj, onlyDigits } from '@della/shared';

const trimmed = () => z.string().trim();

/** Campo de texto opcional: string vazia vira null. */
export const optText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const reqText = (max = 200) => trimmed().min(1).max(max);

export const cnpjSchema = z
  .string()
  .trim()
  .refine((v) => isValidCnpj(v), 'CNPJ inválido. Confira os dígitos.')
  .transform((v) => normalizeCnpj(v));

export const cpfOpt = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? onlyDigits(v) : null))
  .refine((v) => v === null || isValidCpf(v), 'CPF inválido.');

export const phoneOpt = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? onlyDigits(v) : null))
  .refine((v) => v === null || v.length === 10 || v.length === 11, 'Telefone inválido. Use DDD + número.');

export const emailOpt = z
  .string()
  .trim()
  .toLowerCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'E-mail inválido.');

export const cepOpt = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? onlyDigits(v) : null))
  .refine((v) => v === null || v.length === 8, 'CEP inválido.');

export const centsSchema = z.number().int('Use valores em centavos inteiros.').min(0, 'O valor não pode ser negativo.').max(2_000_000_000);
export const bpsSchema = z.number().int().min(0, 'O percentual não pode ser negativo.').max(10_000, 'O percentual não pode passar de 100%.');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
export const isoDateOpt = isoDate.nullish().transform((v) => v ?? null);
export const uuid = z.string().uuid();

export const passwordSchema = z
  .string()
  .min(8, 'A senha deve ter pelo menos 8 caracteres.')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'A senha deve conter letras e números.')
  .refine((v) => !['12345678', 'password1', 'senha123', 'della123'].includes(v.toLowerCase()), 'Senha muito comum.');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export function pageArgs(p: { page: number; pageSize: number }) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paged<T>(items: T[], total: number, p: { page: number; pageSize: number }) {
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Converte "YYYY-MM-DD" em Date (UTC meia-noite) para colunas @db.Date. */
export function toDbDate(v: string | null | undefined): Date | null {
  return v ? new Date(`${v}T00:00:00.000Z`) : null;
}

export function fromDbDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
