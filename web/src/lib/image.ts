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

/**
 * Foto de produto: mantém o fundo transparente (PNG/WebP recortado, como nos sites dos fabricantes).
 * Gera WebP (leve, com transparência); se o navegador não gerar WebP, usa PNG. Fotos sem transparência viram JPEG.
 */
export async function shrinkProductImage(file: File, maxSide = 1000): Promise<{ blob: Blob; ext: string }> {
  if (!file.type.startsWith('image/')) return { blob: file, ext: file.name.split('.').pop() ?? 'jpg' };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = false;
    for (let i = 3; i < px.length; i += 16) if (px[i] < 250) { transparent = true; break; }
    const toBlob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
    if (transparent) {
      const webp = await toBlob('image/webp', 0.86);
      if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
      const png = await toBlob('image/png');
      if (png) return { blob: png, ext: 'png' };
    }
    return { blob: await shrinkImage(file, maxSide), ext: 'jpg' };
  } catch {
    return { blob: file, ext: file.name.split('.').pop() ?? 'jpg' };
  }
}
