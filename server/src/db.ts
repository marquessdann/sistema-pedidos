import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : process.env.NODE_ENV === 'test' ? [] : ['error'],
});

export type Tx = Prisma.TransactionClient;
export { Prisma };
