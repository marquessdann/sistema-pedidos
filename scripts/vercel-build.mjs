/**
 * Build no Vercel: gera o cliente Prisma, aplica as migrações no banco, compila web + API
 * e executa o seed (idempotente: cria configurações, administrador e o Victor apenas se não existirem).
 */
import { execSync } from 'node:child_process';
import { applyCloudEnv } from './cloud-env.mjs';

const env = applyCloudEnv({ ...process.env });
if (!env.DATABASE_URL) {
  console.error('✖ DATABASE_URL não definida. Conecte um banco PostgreSQL ao projeto no Vercel (aba Storage).');
  process.exit(1);
}
const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env });
};
run('npx prisma generate --schema server/prisma/schema.prisma');
run('npx prisma migrate deploy --schema server/prisma/schema.prisma');
run('npm run build');
run('node server/dist/seed.js');
