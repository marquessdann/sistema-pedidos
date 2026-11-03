import crypto from 'node:crypto';

/**
 * Hash de senhas com scrypt (nativo do Node.js, sem dependência binária — funciona em serverless).
 * Parâmetros: N=2^15, r=8, p=1, chave de 64 bytes, sal aleatório de 16 bytes (recomendação OWASP).
 * Formato armazenado: scrypt$N$r$p$salBase64$hashBase64
 */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(pwd: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pwd.normalize('NFKC'), salt, keylen, { N: n, r, p, maxmem: 256 * n * r }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(plain, salt, KEYLEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, Number(n), Number(r), Number(p));
    return crypto.timingSafeEqual(actual, expected);
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
