import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db';
import { isoDate, pageArgs, paged, paginationSchema } from '../../lib/validation';
import { getSettings } from '../../lib/settings';
import { startOfDayInTz, addDays } from '@della/shared';

/** Consulta do log de auditoria (somente leitura: não existem rotas de alteração/exclusão). */
export async function adminAuditRoutes(app: FastifyInstance) {
  app.get('/audit', async (req) => {
    const q = paginationSchema
      .extend({
        entity: z.string().max(40).optional(),
        entityId: z.string().max(60).optional(),
        userId: z.string().uuid().optional(),
        action: z.string().max(60).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .parse(req.query);
    const tz = (await getSettings()).timezone;
    const where = {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.action ? { action: { contains: q.action.toUpperCase() } } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: startOfDayInTz(q.from, tz) } : {}),
              ...(q.to ? { lt: startOfDayInTz(addDays(q.to, 1), tz) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true, username: true } } }, ...pageArgs(q) }),
      prisma.auditLog.count({ where }),
    ]);
    return paged(items, total, q);
  });
}
