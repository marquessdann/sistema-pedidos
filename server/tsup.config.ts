import { defineConfig } from 'tsup';

export default defineConfig({
  // entradas nomeadas: tudo sai plano em dist/ (os caminhos relativos para web/dist e storage dependem disso)
  entry: { server: 'src/server.ts', 'create-admin': 'src/scripts/createAdmin.ts', seed: 'prisma/seed.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // inclui o pacote compartilhado (TypeScript) dentro do bundle
  noExternal: ['@della/shared'],
});
