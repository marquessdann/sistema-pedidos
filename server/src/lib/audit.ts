import type { Tx } from '../db';
import { prisma } from '../db';

export interface AuditActor {
  userId: string | null;
  ip?: string | null;
}

/** Remove campos sensíveis antes de gravar no log. */
function sanitize(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return data.map(sanitize);
  if (data instanceof Date) return data.toISOString();
  if (typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (/password|senha|token|secret|hash/i.test(k)) continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return data;
}

export async function audit(
  db: Tx | typeof prisma,
  actor: AuditActor,
  action: string,
  entity: string,
  entityId: string | null,
  data?: unknown,
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: actor.userId,
      ip: actor.ip ?? null,
      action,
      entity,
      entityId,
      data: data === undefined ? undefined : (sanitize(data) as object),
    },
  });
}

/** Retorna apenas os campos alterados entre dois objetos (para registrar "antes/depois"). */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const a = before[key] instanceof Date ? (before[key] as Date).toISOString() : before[key];
    const b = after[key] instanceof Date ? (after[key] as Date).toISOString() : after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a, to: b };
  }
  return changes;
}
