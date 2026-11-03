// Função serverless do Vercel: encaminha /api/* para a aplicação Fastify compilada (server/dist/vercel.js).
import { applyCloudEnv } from '../scripts/cloud-env.mjs';

applyCloudEnv();
const { default: handler } = await import('../server/dist/vercel.js');

export default handler;
