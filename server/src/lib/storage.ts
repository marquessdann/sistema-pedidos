import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { storageDir } from '../config';
import { AppError } from './errors';

export type StorageArea = 'products' | 'company' | 'documents';

export function areaDir(area: StorageArea) {
  return path.join(storageDir, area);
}

export async function ensureStorage() {
  for (const a of ['products', 'company', 'documents'] as StorageArea[]) {
    await fs.mkdir(areaDir(a), { recursive: true });
  }
}

/** Resolve o caminho de um arquivo garantindo que não saia da pasta (proteção contra path traversal). */
export function filePath(area: StorageArea, fileName: string) {
  if (!/^[a-zA-Z0-9-]+\.(png|jpg|webp|pdf)$/.test(fileName)) throw new AppError(400, 'Nome de arquivo inválido.', 'BAD_FILE');
  const p = path.join(areaDir(area), fileName);
  if (!p.startsWith(areaDir(area) + path.sep)) throw new AppError(400, 'Nome de arquivo inválido.', 'BAD_FILE');
  return p;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

export async function saveImage(area: 'products' | 'company', buf: Buffer) {
  if (buf.length === 0) throw new AppError(400, 'Arquivo vazio.', 'BAD_FILE');
  if (buf.length > MAX_IMAGE_BYTES) throw new AppError(413, 'Imagem acima de 5 MB.', 'FILE_TOO_LARGE');
  const type = detectImage(buf);
  if (!type) throw new AppError(415, 'Formato não suportado. Envie PNG, JPG ou WEBP.', 'BAD_FILE_TYPE');
  const fileName = `${crypto.randomUUID()}.${type.ext}`;
  await fs.writeFile(filePath(area, fileName), buf);
  return { fileName, mimeType: type.mime };
}

export async function removeFile(area: StorageArea, fileName: string) {
  await fs.rm(filePath(area, fileName), { force: true });
}

export function mimeFor(fileName: string) {
  if (fileName.endsWith('.png')) return 'image/png';
  if (fileName.endsWith('.jpg')) return 'image/jpeg';
  if (fileName.endsWith('.webp')) return 'image/webp';
  if (fileName.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}
