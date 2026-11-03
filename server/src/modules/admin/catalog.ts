import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mulBps } from '@della/shared';
import { prisma } from '../../db';
import { actor } from '../../lib/auth';
import { audit, diff } from '../../lib/audit';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { copyFile, removeFile, saveImage } from '../../lib/storage';
import { bpsSchema, centsSchema, optText, pageArgs, paged, paginationSchema, reqText } from '../../lib/validation';

const idParam = z.object({ id: z.string().uuid() });

const productSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(60)
    .regex(/^[A-Z0-9._\-/]+$/, 'Código/SKU: use letras, números, ponto, hífen, barra ou sublinhado.'),
  name: reqText(200),
  brandId: z.string().uuid({ message: 'Selecione a marca.' }),
  categoryId: z.string().uuid().nullish().transform((v) => v ?? null),
  description: optText(4000),
  unit: z.string().trim().toUpperCase().min(1).max(10).default('UN'),
  unitsPerBox: z
    .number()
    .int('Unidades por caixa: use um número inteiro.')
    .min(2, 'Unidades por caixa: mínimo 2.')
    .max(100_000)
    .nullish()
    .transform((v) => v ?? null),
  costCents: centsSchema.default(0),
  taxRefBps: bpsSchema.default(0),
  priceCents: centsSchema,
  stockQty: z.number().int().min(0).max(100_000_000).optional(),
  active: z.boolean().default(true),
  internalNotes: optText(2000),
});

/** Margem estimada de referência = (preço − custo − tributo de referência) / preço */
function withMargin<T extends { priceCents: number; costCents: number; taxRefBps: number }>(p: T) {
  const tax = mulBps(p.priceCents, p.taxRefBps);
  const marginCents = p.priceCents - p.costCents - tax;
  const marginBps = p.priceCents > 0 ? Math.round((marginCents * 10000) / p.priceCents) : null;
  const markupBps = p.costCents > 0 ? Math.round(((p.priceCents - p.costCents) * 10000) / p.costCents) : null;
  return { ...p, estimatedTaxCents: tax, marginCents, marginBps, markupBps };
}

export async function adminCatalogRoutes(app: FastifyInstance) {
  // ---------------- Marcas ----------------
  app.get('/brands', async () => {
    const brands = await prisma.brand.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { products: { where: { deletedAt: null } } } } } });
    return brands.map(({ _count, ...b }) => ({ ...b, productCount: _count.products }));
  });
  app.post('/brands', async (req, reply) => {
    const b = z.object({ name: reqText(80), active: z.boolean().default(true), sortOrder: z.number().int().default(0) }).parse(req.body);
    const exists = await prisma.brand.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' } } });
    if (exists) throw conflict('Já existe uma marca com este nome.');
    const brand = await prisma.brand.create({ data: b });
    await audit(prisma, actor(req), 'BRAND_CREATED', 'brand', brand.id, b);
    return reply.status(201).send(brand);
  });
  app.put('/brands/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ name: reqText(80), active: z.boolean(), sortOrder: z.number().int().default(0) }).parse(req.body);
    const exists = await prisma.brand.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' }, id: { not: id } } });
    if (exists) throw conflict('Já existe uma marca com este nome.');
    const before = await prisma.brand.findUnique({ where: { id } });
    if (!before) throw notFound('Marca');
    const brand = await prisma.brand.update({ where: { id }, data: b });
    await audit(prisma, actor(req), 'BRAND_UPDATED', 'brand', id, diff(before, b));
    return brand;
  });

  // ---------------- Categorias ----------------
  app.get('/categories', async () => {
    const cats = await prisma.category.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { products: { where: { deletedAt: null } } } } } });
    return cats.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  });
  app.post('/categories', async (req, reply) => {
    const b = z.object({ name: reqText(80), active: z.boolean().default(true) }).parse(req.body);
    const exists = await prisma.category.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' } } });
    if (exists) throw conflict('Já existe uma categoria com este nome.');
    const c = await prisma.category.create({ data: b });
    await audit(prisma, actor(req), 'CATEGORY_CREATED', 'category', c.id, b);
    return reply.status(201).send(c);
  });
  app.put('/categories/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z.object({ name: reqText(80), active: z.boolean() }).parse(req.body);
    const exists = await prisma.category.findFirst({ where: { name: { equals: b.name, mode: 'insensitive' }, id: { not: id } } });
    if (exists) throw conflict('Já existe uma categoria com este nome.');
    const c = await prisma.category.update({ where: { id }, data: b });
    await audit(prisma, actor(req), 'CATEGORY_UPDATED', 'category', id, b);
    return c;
  });

  // ---------------- Produtos ----------------
  app.get('/products', async (req) => {
    const q = paginationSchema
      .extend({
        q: z.string().trim().max(100).optional(),
        brandId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        status: z.enum(['active', 'inactive', 'all']).default('all'),
        sort: z.enum(['name', 'sku', 'price_desc', 'price_asc', 'recent']).default('name'),
      })
      .parse(req.query);
    const where = {
      deletedAt: null,
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.status === 'active' ? { active: true } : q.status === 'inactive' ? { active: false } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' as const } },
              { sku: { contains: q.q, mode: 'insensitive' as const } },
              { brand: { name: { contains: q.q, mode: 'insensitive' as const } } },
              { category: { name: { contains: q.q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const orderBy =
      q.sort === 'sku' ? { sku: 'asc' as const } : q.sort === 'price_desc' ? { priceCents: 'desc' as const } : q.sort === 'price_asc' ? { priceCents: 'asc' as const } : q.sort === 'recent' ? { createdAt: 'desc' as const } : { name: 'asc' as const };
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 },
        },
        orderBy,
        ...pageArgs(q),
      }),
      prisma.product.count({ where }),
    ]);
    return paged(items.map(withMargin), total, q);
  });

  app.get('/products/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        brand: true,
        category: true,
        images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
        priceHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!p || p.deletedAt) throw notFound('Produto');
    return withMargin(p);
  });

  app.get('/products-check-sku', async (req) => {
    const { sku, excludeId } = z.object({ sku: z.string().trim().toUpperCase(), excludeId: z.string().uuid().optional() }).parse(req.query);
    const p = await prisma.product.findFirst({ where: { sku, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true } });
    return { exists: !!p, product: p };
  });

  app.post('/products', async (req, reply) => {
    const data = productSchema.parse(req.body);
    if (await prisma.product.findUnique({ where: { sku: data.sku } })) throw conflict(`Já existe um produto com o código ${data.sku}.`, 'DUPLICATE_SKU');
    const { stockQty = 0, ...rest } = data;
    const p = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { ...rest, stockQty, createdById: req.user!.id, updatedById: req.user!.id } });
      await tx.productPriceHistory.create({ data: { productId: created.id, newPriceCents: created.priceCents, newCostCents: created.costCents, changedById: req.user!.id } });
      if (stockQty > 0) {
        await tx.stockMovement.create({
          data: { productId: created.id, type: 'IN', quantity: stockQty, stockAfter: stockQty, reservedAfter: 0, reason: 'Estoque inicial no cadastro', userId: req.user!.id },
        });
      }
      await audit(tx, actor(req), 'PRODUCT_CREATED', 'product', created.id, data);
      return created;
    });
    return reply.status(201).send(withMargin(p));
  });

  app.put('/products/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const { stockQty: _ignored, ...data } = productSchema.parse(req.body); // estoque só muda por movimentação
    const before = await prisma.product.findUnique({ where: { id } });
    if (!before || before.deletedAt) throw notFound('Produto');
    if (await prisma.product.findFirst({ where: { sku: data.sku, id: { not: id } } })) throw conflict(`Já existe um produto com o código ${data.sku}.`, 'DUPLICATE_SKU');
    const p = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: { ...data, updatedById: req.user!.id } });
      const changes = diff(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
      if (before.priceCents !== data.priceCents || before.costCents !== data.costCents) {
        await tx.productPriceHistory.create({
          data: { productId: id, oldPriceCents: before.priceCents, newPriceCents: data.priceCents, oldCostCents: before.costCents, newCostCents: data.costCents, changedById: req.user!.id },
        });
        await audit(tx, actor(req), 'PRODUCT_PRICE_CHANGED', 'product', id, {
          sku: data.sku,
          price: { from: before.priceCents, to: data.priceCents },
          cost: { from: before.costCents, to: data.costCents },
        });
      }
      await audit(tx, actor(req), 'PRODUCT_UPDATED', 'product', id, changes);
      return updated;
    });
    return withMargin(p);
  });

  app.post('/products/:id/active', async (req) => {
    const { id } = idParam.parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const p = await prisma.product.update({ where: { id }, data: { active, updatedById: req.user!.id } });
    await audit(prisma, actor(req), active ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED', 'product', id, { sku: p.sku });
    return withMargin(p);
  });

  app.post('/products/:id/duplicate', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const src = await prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!src || src.deletedAt) throw notFound('Produto');
    let sku = `${src.sku}-COPIA`;
    for (let i = 2; await prisma.product.findUnique({ where: { sku } }); i++) sku = `${src.sku}-COPIA${i}`;
    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sku,
          name: `${src.name} (cópia)`,
          brandId: src.brandId,
          categoryId: src.categoryId,
          description: src.description,
          unit: src.unit,
          unitsPerBox: src.unitsPerBox,
          costCents: src.costCents,
          taxRefBps: src.taxRefBps,
          priceCents: src.priceCents,
          active: false,
          internalNotes: src.internalNotes,
          createdById: req.user!.id,
          updatedById: req.user!.id,
        },
      });
      for (const img of src.images) {
        const copy = await copyFile('products', img.fileName, tx);
        if (copy) await tx.productImage.create({ data: { productId: created.id, fileName: copy.fileName, mimeType: img.mimeType, isPrimary: img.isPrimary, sortOrder: img.sortOrder } });
      }
      await tx.productPriceHistory.create({ data: { productId: created.id, newPriceCents: created.priceCents, newCostCents: created.costCents, changedById: req.user!.id } });
      await audit(tx, actor(req), 'PRODUCT_DUPLICATED', 'product', created.id, { sourceId: id, sku });
      return created;
    });
    return reply.status(201).send(withMargin(copy));
  });

  // ---------------- Imagens ----------------
  app.post('/products/:id/images', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const product = await prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!product || product.deletedAt) throw notFound('Produto');
    if (!req.isMultipart()) throw new AppError(400, 'Envie as imagens como multipart/form-data.');
    const saved = [];
    let hasPrimary = product.images.some((i) => i.isPrimary);
    let order = product.images.length;
    for await (const part of req.files()) {
      const buf = await part.toBuffer();
      if (part.file.truncated) throw new AppError(413, 'Imagem acima de 5 MB.', 'FILE_TOO_LARGE');
      const { fileName, mimeType } = await saveImage('products', buf);
      const img = await prisma.productImage.create({ data: { productId: id, fileName, mimeType, isPrimary: !hasPrimary, sortOrder: order++ } });
      hasPrimary = true;
      saved.push(img);
    }
    if (!saved.length) throw unprocessable('Nenhuma imagem recebida.');
    await audit(prisma, actor(req), 'PRODUCT_IMAGES_ADDED', 'product', id, { count: saved.length });
    return reply.status(201).send(saved);
  });

  app.post('/products/:id/images/:imageId/primary', async (req) => {
    const { id, imageId } = z.object({ id: z.string().uuid(), imageId: z.string().uuid() }).parse(req.params);
    const img = await prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!img) throw notFound('Imagem');
    await prisma.$transaction([
      prisma.productImage.updateMany({ where: { productId: id }, data: { isPrimary: false } }),
      prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
    return { ok: true };
  });

  app.delete('/products/:id/images/:imageId', async (req) => {
    const { id, imageId } = z.object({ id: z.string().uuid(), imageId: z.string().uuid() }).parse(req.params);
    const img = await prisma.productImage.findFirst({ where: { id: imageId, productId: id } });
    if (!img) throw notFound('Imagem');
    await prisma.productImage.delete({ where: { id: imageId } });
    // mantém o arquivo se ele ainda for referenciado por itens históricos de pedidos/orçamentos
    const referenced =
      (await prisma.orderItem.count({ where: { imageFileName: img.fileName } })) + (await prisma.quoteItem.count({ where: { imageFileName: img.fileName } }));
    if (!referenced) await removeFile('products', img.fileName);
    if (img.isPrimary) {
      const next = await prisma.productImage.findFirst({ where: { productId: id }, orderBy: { sortOrder: 'asc' } });
      if (next) await prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await audit(prisma, actor(req), 'PRODUCT_IMAGE_REMOVED', 'product', id, { imageId });
    return { ok: true };
  });
}
