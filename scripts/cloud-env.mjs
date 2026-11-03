/**
 * Normaliza as variáveis de banco fornecidas pelas integrações de nuvem (Neon pelo Vercel, Supabase…).
 * - DATABASE_URL: conexão usada pela aplicação (de preferência via pooler)
 * - DIRECT_URL: conexão direta, usada pelas migrações
 * Aceita nomes padrão (DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL…) e também nomes com prefixo
 * personalizado criados pela integração (ex.: STORAGE_URL, STORAGE_DATABASE_URL_UNPOOLED).
 */
const isPg = (v) => typeof v === 'string' && /^postgres(ql)?:\/\//.test(v);
const isDirectName = (k) => /UNPOOLED|NON_POOLING|DIRECT/i.test(k);

/** Nomes (nunca valores) das variáveis que parecem conexões PostgreSQL — para diagnóstico. */
export function pgVarNames(env = process.env) {
  return Object.keys(env).filter((k) => isPg(env[k])).sort();
}

export function applyCloudEnv(env = process.env) {
  const names = pgVarNames(env);
  const pick = (preferred, filter) => preferred.map((k) => env[k]).find(isPg) ?? names.filter(filter).map((k) => env[k])[0];

  env.DATABASE_URL = isPg(env.DATABASE_URL)
    ? env.DATABASE_URL
    : pick(['POSTGRES_PRISMA_URL', 'POSTGRES_URL'], (k) => !isDirectName(k) && /URL/i.test(k)) ?? env.DATABASE_URL;
  env.DIRECT_URL = isPg(env.DIRECT_URL)
    ? env.DIRECT_URL
    : pick(['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'], (k) => isDirectName(k)) ?? env.DATABASE_URL;

  // Pooler em modo transação (Neon "-pooler", Supabase porta 6543): o Prisma precisa de pgbouncer=true
  if (isPg(env.DATABASE_URL) && /-pooler\.|:6543\//.test(env.DATABASE_URL) && !/pgbouncer=true/.test(env.DATABASE_URL)) {
    env.DATABASE_URL += (env.DATABASE_URL.includes('?') ? '&' : '?') + 'pgbouncer=true&connection_limit=1';
  }
  return env;
}
