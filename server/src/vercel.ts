/**
 * Entrada da API como função serverless (Vercel).
 * A mesma aplicação Fastify do servidor tradicional é criada uma vez por instância e reaproveitada.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';

let appPromise: Promise<FastifyInstance> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  appPromise ??= buildApp().then(async (app) => {
    await app.ready();
    return app;
  });
  const app = await appPromise;
  app.server.emit('request', req, res);
}
