import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import { getSettings } from '../../lib/settings';
import { getFile } from '../../lib/storage';

export async function fileRoutes(app: FastifyInstance) {
  // imagens de produtos: somente usuários autenticados
  app.get('/products/:fileName', { preHandler: requireAuth }, async (req, reply) => {
    const { fileName } = z.object({ fileName: z.string().max(80) }).parse(req.params);
    const f = await getFile('products', fileName);
    reply.header('Cache-Control', 'private, max-age=86400, immutable');
    reply.type(f.mimeType);
    return reply.send(f.data);
  });

  // logotipo da empresa (público, exibido na tela de login)
  app.get('/company/logo', async (_req, reply) => {
    const s = await getSettings();
    if (!s.logoFileName) throw notFound('Logotipo');
    const f = await getFile('company', s.logoFileName);
    reply.header('Cache-Control', 'public, max-age=300');
    reply.type(f.mimeType);
    return reply.send(f.data);
  });
}
