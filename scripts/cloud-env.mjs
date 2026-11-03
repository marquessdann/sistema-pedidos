/**
 * Normaliza as variáveis de banco fornecidas pelas integrações de nuvem (Neon/Vercel Postgres, Supabase).
 * - DATABASE_URL: conexão via pooler (usada pela aplicação)
 * - DIRECT_URL: conexão direta (usada pelas migrações)
 */
export function applyCloudEnv(env = process.env) {
  env.DATABASE_URL ||= env.POSTGRES_PRISMA_URL || env.POSTGRES_URL;
  env.DIRECT_URL ||= env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL;
  // Pooler em modo transação (Neon "-pooler", Supabase porta 6543): o Prisma precisa de pgbouncer=true
  if (env.DATABASE_URL && /-pooler\.|:6543\//.test(env.DATABASE_URL) && !/pgbouncer=true/.test(env.DATABASE_URL)) {
    env.DATABASE_URL += (env.DATABASE_URL.includes('?') ? '&' : '?') + 'pgbouncer=true&connection_limit=1';
  }
  return env;
}
