import type { CompanySettings } from '@prisma/client';
import { prisma } from '../db';
import type { Tx } from '../db';
import { todayInTz } from '@della/shared';

export async function getSettings(db: Tx | typeof prisma = prisma): Promise<CompanySettings> {
  const s = await db.companySettings.findUnique({ where: { id: 1 } });
  if (s) return s;
  return db.companySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export function today(settings: Pick<CompanySettings, 'timezone'>): string {
  return todayInTz(settings.timezone);
}
