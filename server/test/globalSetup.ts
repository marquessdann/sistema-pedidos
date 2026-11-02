import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

export default function setup() {
  const envFile = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://della:della@localhost:5432/della_test?schema=public';
  if (!/test/i.test(url)) throw new Error('TEST_DATABASE_URL deve apontar para um banco de TESTE (o nome deve conter "test").');
  // aplica as migrações pendentes no banco de teste (não destrutivo)
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  return () => {
    fs.rmSync(path.resolve(__dirname, '../test-storage'), { recursive: true, force: true });
  };
}
