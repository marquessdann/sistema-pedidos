import path from 'node:path';
import fs from 'node:fs';
import { defineConfig } from 'vitest/config';

const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const testDb = process.env.TEST_DATABASE_URL ?? 'postgresql://della:della@localhost:5432/della_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDb,
      DIRECT_URL: testDb,
    },
  },
});
