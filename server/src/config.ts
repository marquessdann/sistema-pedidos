import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  PORT: z.coerce.number().int().default(3333),
  HOST: z.string().default('0.0.0.0'),
  APP_URL: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool,
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  /** Vendedor trabalha em campo (modo sem internet): sessão longa, renovada a cada uso. */
  SELLER_SESSION_TTL_DAYS: z.coerce.number().positive().default(30),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Não exibe valores, apenas os nomes das variáveis com problema.
  console.error('Configuração inválida:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export const emailEnabled = !!env.SMTP_HOST;
export const whatsappApiEnabled = !!(env.WHATSAPP_API_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
