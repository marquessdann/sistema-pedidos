import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../lib/auth';
import { adminAuditRoutes } from './auditLog';
import { adminCatalogRoutes } from './catalog';
import { adminClientRoutes } from './clients';
import { adminCommercialRoutes } from './commercial';
import { adminReportRoutes } from './reports';
import { adminRepRoutes } from './reps';
import { adminSettingsRoutes } from './settings';
import { adminStockRoutes } from './stock';

/** Todas as rotas /api/admin/* exigem sessão de ADMINISTRADOR, validada no servidor. */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);
  await app.register(adminClientRoutes);
  await app.register(adminRepRoutes);
  await app.register(adminCatalogRoutes);
  await app.register(adminSettingsRoutes);
  await app.register(adminCommercialRoutes);
  await app.register(adminStockRoutes);
  await app.register(adminReportRoutes);
  await app.register(adminAuditRoutes);
}
