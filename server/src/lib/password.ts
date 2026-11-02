import { hash, verify } from '@node-rs/argon2';

// Argon2id com parâmetros recomendados pela OWASP
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

let dummyHash: string | null = null;
/** Executa uma verificação "falsa" para equalizar o tempo de resposta quando o usuário não existe. */
export async function dummyVerify(plain: string): Promise<void> {
  dummyHash ??= await hashPassword('dummy-password-for-timing-1');
  await verifyPassword(dummyHash, plain);
}
