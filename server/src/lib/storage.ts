import crypto from 'node:crypto';
import { prisma } from '../db';
import type { Tx } from '../db';
import { AppError, notFound } from './errors';

/**
 * Armazenamento de arquivos no próprio PostgreSQL (tabela stored_files).
 * Hospedagens serverless (Vercel) não têm disco persistente; guardar no banco evita depender
 * de outro serviço e mantém o backup em um só lugar (pg_dump inclui imagens, logotipo e PDFs).
 */
export type StorageArea = 'products' | 'company' | 'documents';

// limite do corpo das requisições no Vercel é ~4,5 MB; o navegador reduz as fotos antes de enviar
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function checkName(fileName: string) {
  if (!/^[a-zA-Z0-9-]+\.(png|jpg|webp|pdf)$/.test(fileName)) throw new AppError(400, 'Nome de arquivo inválido.', 'BAD_FILE');
}

/** Detecta o tipo real da imagem pelos "magic bytes" (não confia na extensão nem no Content-Type). */
export function detectImage(buf: Buffer): { ext: 'png' | 'jpg' | 'webp'; mime: string } | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

export async function putFile(area: StorageArea, buf: Buffer, ext: string, mimeType: string, db: Tx | typeof prisma = prisma) {
  const fileName = `${crypto.randomUUID()}.${ext}`;
  await db.storedFile.create({ data: { area, fileName, mimeType, sizeBytes: buf.length, data: new Uint8Array(buf) } });
  return { fileName, mimeType };
}

export async function saveImage(area: 'products' | 'company', buf: Buffer) {
  if (buf.length === 0) throw new AppError(400, 'Arquivo vazio.', 'BAD_FILE');
  if (buf.length > MAX_IMAGE_BYTES) throw new AppError(413, 'Imagem acima de 4 MB.', 'FILE_TOO_LARGE');
  const type = detectImage(buf);
  if (!type) throw new AppError(415, 'Formato não suportado. Envie PNG, JPG ou WEBP.', 'BAD_FILE_TYPE');
  return putFile(area, buf, type.ext, type.mime);
}

export async function getFile(area: StorageArea, fileName: string) {
  checkName(fileName);
  const f = await prisma.storedFile.findUnique({ where: { fileName } });
  if (!f || f.area !== area) throw notFound('Arquivo');
  return { data: Buffer.from(f.data), mimeType: f.mimeType, sizeBytes: f.sizeBytes };
}

export async function copyFile(area: StorageArea, fileName: string, db: Tx | typeof prisma = prisma) {
  const src = await getFile(area, fileName).catch(() => null);
  if (!src) return null;
  return putFile(area, src.data, fileName.split('.').pop()!, src.mimeType, db);
}

export async function removeFile(area: StorageArea, fileName: string) {
  checkName(fileName);
  await prisma.storedFile.deleteMany({ where: { area, fileName } });
}
