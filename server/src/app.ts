import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import './lib/zodPt';
import { env, isProd, isTest } from './config';
import { prisma } from './db';
import { loadSession } from './lib/auth';
import { errorHandler } from './lib/errors';
import { MAX_IMAGE_BYTES } from './lib/storage';
import { authRoutes } from './modules/auth/routes';
import { adminRoutes } from './modules/admin';
import { sellerRoutes } from './modules/seller';
import { managerRoutes } from './modules/manager';
import { cnpjRoutes } from './modules/cnpj';
import { logisticsRoutes } from './modules/logistics';
import { documentRoutes, type PdfRenderer } from './modules/documents/routes';
import { fileRoutes } from './modules/documents/files';

export interface AppDeps {
  logger?: boolean;
  /** Permite substituir o gerador de PDF (usado nos testes de falha). */
  pdfRenderer?: PdfRenderer;
}

export async function buildApp(deps: AppDeps = {}) {
  const app = Fastify({
    logger:
      deps.logger === false || isTest
        ? false
        : {
            level: isProd ? 'info' : 'debug',
            // nunca registrar cookies, senhas ou tokens
            redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
          },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        connectSrc: ["'self'", 'https://viacep.com.br'],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'self'", 'blob:'],
        scriptSrc: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 10, fields: 10 } });

  app.decorateRequest('user', null);
  app.decorateRequest('rep', null);
  app.decorateRequest('manager', null);
  app.decorateRequest('sessionId', null);
  app.decorateRequest('csrfToken', null);
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/')) await loadSession(req, reply);
  });
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler(errorHandler);

  app.get('/api/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, time: new Date().toISOString() };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(sellerRoutes, { prefix: '/api/seller' });
  await app.register(managerRoutes, { prefix: '/api/manager' });
  await app.register(cnpjRoutes, { prefix: '/api/cnpj' });
  await app.register(logisticsRoutes, { prefix: '/api/logistics' });
  await app.register(documentRoutes(deps.pdfRenderer), { prefix: '/api/documents' });
  await app.register(fileRoutes, { prefix: '/api/files' });

  // Frontend compilado (produção): serve web/dist e devolve index.html para rotas do SPA
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  const hasWeb = fs.existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !hasWeb || req.method !== 'GET' || /\.[a-z0-9]+(\?|$)/i.test(req.url)) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Rota não encontrada.' });
    }
    return reply.sendFile('index.html');
  });

  void env;
  return app;
}
