import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db';
import { audit } from '../../lib/audit';
import { actor, createSession, destroySession, destroyUserSessions, requireAuth } from '../../lib/auth';
import { AppError } from '../../lib/errors';
import { dummyVerify, hashPassword, verifyPassword } from '../../lib/password';
import { getSettings } from '../../lib/settings';
import { isTest } from '../../config';
import { passwordSchema } from '../../lib/validation';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

async function mePayload(req: FastifyRequest, csrfToken?: string) {
  const settings = await getSettings();
  const u = req.user!;
  const rep = req.rep;
  return {
    user: { id: u.id, username: u.username, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword },
    rep: rep
      ? {
          id: rep.id,
          fullName: rep.fullName,
          title: rep.title,
          maxDiscountBps: rep.maxDiscountBps,
          canViewAllOrders: rep.canViewAllOrders,
          canViewCost: rep.canViewCost,
          canViewClientTotals: rep.canViewClientTotals,
          canViewFinanceContact: rep.canViewFinanceContact,
          phone: rep.phone,
          contactPhone: rep.contactPhone,
        }
      : null,
    manager: req.manager ? { perms: req.manager.perms, repIds: req.manager.repIds } : null,
    csrfToken: csrfToken ?? req.csrfToken,
    company: { name: settings.companyName, timezone: settings.timezone, hasLogo: !!settings.logoFileName },
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/login',
    { config: { rateLimit: { max: isTest ? 10_000 : 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ username: z.string().trim().toLowerCase().min(1).max(60), password: z.string().min(1).max(200) }).parse(req.body);
      const user = await prisma.user.findUnique({ where: { username: body.username }, include: { salesRep: true } });
      const invalid = new AppError(401, 'Usuário ou senha inválidos.', 'INVALID_CREDENTIALS');
      if (!user) {
        await dummyVerify(body.password);
        await audit(prisma, { userId: null, ip: req.ip }, 'LOGIN_FAILED', 'user', null, { username: body.username });
        throw invalid;
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new AppError(423, `Usuário temporariamente bloqueado por excesso de tentativas. Tente novamente em até ${LOCK_MINUTES} minutos.`, 'LOCKED');
      }
      const ok = await verifyPassword(user.passwordHash, body.password);
      if (!ok) {
        const count = user.failedLoginCount + 1;
        await prisma.user.update({
          where: { id: user.id },
          data:
            count >= MAX_FAILED
              ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
              : { failedLoginCount: count },
        });
        await audit(prisma, { userId: user.id, ip: req.ip }, count >= MAX_FAILED ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', 'user', user.id);
        throw invalid;
      }
      if (!user.active) throw new AppError(403, 'Usuário inativo. Procure o administrador.', 'USER_INACTIVE');
      if (user.role === 'SELLER' && (!user.salesRep || user.salesRep.deletedAt)) {
        throw new AppError(403, 'Cadastro de representante não encontrado. Procure o administrador.', 'NO_REP');
      }
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
      // limpeza de sessões expiradas (substitui a rotina periódica, inexistente em serverless)
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const { csrfToken } = await createSession(req, reply, user.id);
      await audit(prisma, { userId: user.id, ip: req.ip }, 'LOGIN', 'user', user.id);
      req.user = { id: user.id, username: user.username, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword };
      req.rep = user.salesRep;
      if (user.role === 'MANAGER') {
        const m = await prisma.managerProfile.findUnique({ where: { userId: user.id }, include: { reps: true } });
        if (!m) throw new AppError(403, 'Perfil de gestor não configurado. Procure o administrador.', 'NO_MANAGER_PROFILE');
        const { canViewSales, canViewCommissions, canReleaseProducts, canReleaseClients, canApproveDiscounts, canUpdateOrderStatus } = m;
        req.manager = { id: m.id, perms: { canViewSales, canViewCommissions, canReleaseProducts, canReleaseClients, canApproveDiscounts, canUpdateOrderStatus }, repIds: m.reps.map((r) => r.salesRepId) };
      }
      return mePayload(req, csrfToken);
    },
  );

  app.post('/logout', async (req, reply) => {
    if (req.user) await audit(prisma, actor(req), 'LOGOUT', 'user', req.user.id);
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => mePayload(req));

  app.post('/change-password', { preHandler: requireAuth, config: { rateLimit: { max: isTest ? 10_000 : 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = z
      .object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema })
      .refine((b) => b.currentPassword !== b.newPassword, { message: 'A nova senha deve ser diferente da atual.', path: ['newPassword'] })
      .parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw new AppError(400, 'Senha atual incorreta.', 'WRONG_PASSWORD');
    }
    if (body.newPassword.toLowerCase().includes(user.username.toLowerCase())) {
      throw new AppError(400, 'A senha não pode conter o nome de usuário.', 'WEAK_PASSWORD');
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false } });
    await destroyUserSessions(user.id, req.sessionId);
    await audit(prisma, actor(req), 'PASSWORD_CHANGED', 'user', user.id);
    req.user!.mustChangePassword = false;
    return mePayload(req);
  });
}
