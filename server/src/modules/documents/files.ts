import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import { getSettings } from '../../lib/settings';
import { filePath, mimeFor } from '../../lib/storage';

export async function fileRoutes(app: FastifyInstance) {
  // imagens de produtos: somente usuários autenticados
  app.get('/products/:fileName', { preHandler: requireAuth }, async (req, reply) => {
    const { fileName } = z.object({ fileName: z.string().max(80) }).parse(req.params);
    const p = filePath('products', fileName);
    if (!fs.existsSync(p)) throw notFound('Imagem');
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.type(mimeFor(fileName));
    return reply.send(fs.createReadStream(p));
  });

  // logotipo da empresa (público, exibido na tela de login)
  app.get('/company/logo', async (_req, reply) => {
    const s = await getSettings();
    if (!s.logoFileName) throw notFound('Logotipo');
    const p = filePath('company', s.logoFileName);
    if (!fs.existsSync(p)) throw notFound('Logotipo');
    reply.header('Cache-Control', 'public, max-age=300');
    reply.type(mimeFor(s.logoFileName));
    return reply.send(fs.createReadStream(p));
  });
}
