import { buildApp } from './app';
import { env } from './config';
import { prisma } from './db';
import { expireQuotes } from './modules/commercial/quoteService';

const app = await buildApp();

// tarefas periódicas: expirar orçamentos vencidos e limpar sessões expiradas
async function housekeeping() {
  try {
    const n = await expireQuotes();
    if (n) app.log.info(`${n} orçamento(s) marcado(s) como expirado(s)`);
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (err) {
    app.log.error({ err }, 'Falha na rotina periódica');
  }
}
await housekeeping();
const timer = setInterval(housekeeping, 60 * 60 * 1000);

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
