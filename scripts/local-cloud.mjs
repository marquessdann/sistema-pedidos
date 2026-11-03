/**
 * Simula localmente a hospedagem no Vercel: arquivos estáticos de web/dist + função serverless em /api.
 * Uso: npm run build && node --env-file=.env scripts/local-cloud.mjs   (porta 3000 ou PORT)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web', 'dist');
const { default: handler } = await import(path.join(root, 'api', 'index.mjs'));
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') return handler(req, res);
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  })
  .listen(Number(process.env.PORT ?? 3000), () => console.log(`Simulação Vercel em http://localhost:${process.env.PORT ?? 3000}`));
