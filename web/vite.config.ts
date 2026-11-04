import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Gera o service worker com a lista de arquivos do build (para abrir o sistema sem internet). */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'della-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push('/' + relative(outDir, full).split('\\').join('/'));
        }
      };
      walk(outDir);
      const precache = files.filter((f) => f !== '/sw.js' && !f.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const f of precache) hash.update(f).update(readFileSync(join(outDir, f)));
      const template = readFileSync(resolve(__dirname, 'sw/sw-template.js'), 'utf8');
      const sw = template.replace('__VERSION__', hash.digest('hex').slice(0, 12)).replace('__PRECACHE__', JSON.stringify(precache));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: 'http://localhost:3333', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
