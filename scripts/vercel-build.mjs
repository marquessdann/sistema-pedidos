/**
 * Build no Vercel: gera o cliente Prisma, aplica as migrações no banco, compila web + API
 * e executa o seed (idempotente: cria configurações, administrador e o Victor apenas se não existirem).
 */
import { execSync } from 'node:child_process';
import { applyCloudEnv, pgVarNames } from './cloud-env.mjs';

const env = applyCloudEnv({ ...process.env });
if (!env.DATABASE_URL) {
  console.error('✖ Banco de dados não encontrado: nenhuma variável com conexão PostgreSQL neste ambiente.');
  console.error('  Conecte o banco (aba Storage → Neon) marcando o ambiente "Production" e faça Redeploy.');
  console.error(`  Variáveis de banco encontradas: ${pgVarNames(process.env).join(', ') || 'nenhuma'}`);
  process.exit(1);
}
console.log(`• Banco: usando ${pgVarNames(process.env).join(', ')}`);
const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env });
};
run('npx prisma generate --schema server/prisma/schema.prisma');
run('npx prisma migrate deploy --schema server/prisma/schema.prisma');
run('npm run build');
run('node server/dist/seed.js');
