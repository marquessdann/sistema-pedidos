/**
 * Reduz imagens no próprio aparelho antes do envio (fotos de celular costumam ter 3–10 MB).
 * Mantém a proporção, limita o maior lado e converte para JPEG (ou PNG para preservar transparência).
 */
export async function shrinkImage(file: File, maxSide = 1200, keepPng = false): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 400_000 && (!keepPng || file.type === 'image/png')) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    if (!keepPng) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = keepPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}
