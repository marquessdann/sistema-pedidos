import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db';
import { actor } from '../../lib/auth';
import { audit } from '../../lib/audit';
import { unprocessable } from '../../lib/errors';
import { pageArgs, paged, paginationSchema } from '../../lib/validation';
import { moveStock } from '../commercial/stockService';

export async function adminStockRoutes(app: FastifyInstance) {
  app.get('/stock', async (req) => {
    const q = paginationSchema
      .extend({ q: z.string().trim().max(100).optional(), brandId: z.string().uuid().optional(), onlyLow: z.string().optional() })
      .parse(req.query);
    const where = {
      deletedAt: null,
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { sku: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        select: { id: true, sku: true, name: true, unit: true, active: true, stockQty: true, reservedQty: true, brand: { select: { name: true } } },
        ...pageArgs(q),
      }),
      prisma.product.count({ where }),
    ]);
    return paged(items.map((p) => ({ ...p, availableQty: p.stockQty - p.reservedQty })), total, q);
  });

  app.get('/stock/movements', async (req) => {
    const q = paginationSchema.extend({ productId: z.string().uuid().optional(), orderId: z.string().uuid().optional() }).parse(req.query);
    const where = { ...(q.productId ? { productId: q.productId } : {}), ...(q.orderId ? { orderId: q.orderId } : {}) };
    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { sku: true, name: true } }, user: { select: { name: true } }, order: { select: { id: true, number: true } } },
        ...pageArgs(q),
      }),
      prisma.stockMovement.count({ where }),
    ]);
    return paged(items, total, q);
  });

  app.post('/stock/adjust', async (req) => {
    const b = z
      .object({
        productId: z.string().uuid(),
        type: z.enum(['IN', 'ADJUST', 'RETURN']),
        quantity: z.number().int().min(-100_000_000).max(100_000_000),
        reason: z.string().trim().min(5, 'Informe a justificativa (mínimo 5 caracteres).').max(500),
      })
      .parse(req.body);
    if (b.quantity === 0) throw unprocessable('A quantidade não pode ser zero.');
    if (b.type !== 'ADJUST' && b.quantity < 0) throw unprocessable('Entradas e devoluções devem ter quantidade positiva. Use "Ajuste" para reduzir.');
    await prisma.$transaction(async (tx) => {
      await moveStock(tx, { productId: b.productId, type: b.type, stockDelta: b.quantity, reservedDelta: 0, reason: b.reason, userId: req.user!.id, enforce: true });
      await audit(tx, actor(req), 'STOCK_ADJUSTED', 'product', b.productId, b);
    });
    return prisma.product.findUnique({ where: { id: b.productId }, select: { id: true, stockQty: true, reservedQty: true } });
  });
}
