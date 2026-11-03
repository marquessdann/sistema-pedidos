import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role, SalesRep } from '@prisma/client';
import { prisma } from '../db';
import { env, isProd } from '../config';
import { AppError, forbidden } from './errors';
import type { AuditActor } from './audit';

export const SESSION_COOKIE = 'della_sid';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

export type ManagerPermission =
  | 'canViewSales'
  | 'canViewCommissions'
  | 'canReleaseProducts'
  | 'canReleaseClients'
  | 'canApproveDiscounts'
  | 'canUpdateOrderStatus';

export interface ManagerContext {
  id: string;
  perms: Record<ManagerPermission, boolean>;
  /** vendedores supervisionados */
  repIds: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    rep: SalesRep | null;
    manager: ManagerContext | null;
    sessionId: string | null;
    csrfToken: string | null;
  }
}

function sha256(v: string) {
  return crypto.createHash('sha256').update(v).digest('hex');
}

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      csrfToken,
      userId,
      expiresAt,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
    },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE || isProd,
    expires: expiresAt,
  });
  return { csrfToken };
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Encerra todas as sessões de um usuário (ex.: troca de senha, bloqueio). */
export async function destroyUserSessions(userId: string, exceptSessionId?: string | null) {
  await prisma.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}

/** Hook global: carrega a sessão (se houver) e valida CSRF em requisições que alteram dados. */
export async function loadSession(req: FastifyRequest) {
  req.user = null;
  req.rep = null;
  req.manager = null;
  req.sessionId = null;
  req.csrfToken = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { salesRep: true, managerProfile: { include: { reps: true } } } } },
  });
  if (!session) return;
  if (session.expiresAt < new Date() || !session.user.active) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return;
  }
  const u = session.user;
  if (u.role === 'SELLER' && (!u.salesRep || u.salesRep.deletedAt)) return;
  if (u.role === 'MANAGER') {
    const m = u.managerProfile;
    if (!m) return;
    req.manager = {
      id: m.id,
      perms: {
        canViewSales: m.canViewSales,
        canViewCommissions: m.canViewCommissions,
        canReleaseProducts: m.canReleaseProducts,
        canReleaseClients: m.canReleaseClients,
        canApproveDiscounts: m.canApproveDiscounts,
        canUpdateOrderStatus: m.canUpdateOrderStatus,
      },
      repIds: m.reps.map((r) => r.salesRepId),
    };
  }
  req.user = { id: u.id, username: u.username, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword };
  req.rep = u.salesRep;
  req.sessionId = session.id;
  req.csrfToken = session.csrfToken;
  // renova o último acesso no máximo a cada 5 minutos
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rotas acessíveis mesmo com troca de senha pendente. */
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/change-password', '/api/auth/logout']);

export async function requireAuth(req: FastifyRequest) {
  if (!req.user) throw new AppError(401, 'Sessão expirada ou inválida. Faça login novamente.', 'UNAUTHENTICATED');
  if (!SAFE_METHODS.has(req.method)) {
    const header = req.headers['x-csrf-token'];
    if (!header || header !== req.csrfToken) throw new AppError(403, 'Token de segurança inválido. Recarregue a página.', 'CSRF');
  }
  const path = req.routeOptions.url ?? req.url;
  if (req.user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(path)) {
    throw new AppError(403, 'Você precisa trocar sua senha antes de continuar.', 'PASSWORD_CHANGE_REQUIRED');
  }
}

export async function requireAdmin(req: FastifyRequest) {
  await requireAuth(req);
  if (req.user!.role !== 'ADMIN') throw forbidden('Acesso restrito ao administrador.');
}

export async function requireSeller(req: FastifyRequest) {
  await requireAuth(req);
  if (req.user!.role !== 'SELLER' || !req.rep) throw forbidden('Acesso restrito aos representantes comerciais.');
}

export async function requireManager(req: FastifyRequest) {
  await requireAuth(req);
  if (req.user!.role !== 'MANAGER' || !req.manager) throw forbidden('Acesso restrito aos gestores.');
}

/** Exige uma permissão específica do gestor (validada no servidor). */
export function managerCan(perm: ManagerPermission) {
  return async (req: FastifyRequest) => {
    if (!req.manager?.perms[perm]) throw forbidden('Você não tem permissão para esta operação. Fale com o administrador.');
  };
}

export function actor(req: FastifyRequest): AuditActor {
  return { userId: req.user?.id ?? null, ip: req.ip };
}
