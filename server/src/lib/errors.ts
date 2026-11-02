import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { PricingError } from '@della/shared';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'ERROR',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Registro') => new AppError(404, `${what} não encontrado.`, 'NOT_FOUND');
export const forbidden = (msg = 'Você não tem permissão para esta operação.') => new AppError(403, msg, 'FORBIDDEN');
export const conflict = (msg: string, code = 'CONFLICT', details?: unknown) => new AppError(409, msg, code, details);
export const unprocessable = (msg: string, code = 'UNPROCESSABLE', details?: unknown) =>
  new AppError(422, msg, code, details);

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'VALIDATION',
      message: error.issues[0]?.message ?? 'Dados inválidos.',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message, details: error.details });
  }
  if (error instanceof PricingError) {
    return reply.status(422).send({ error: 'PRICING', message: error.message });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return reply.status(409).send({ error: 'DUPLICATE', message: 'Já existe um registro com estes dados.' });
    }
    if (error.code === 'P2025') {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Registro não encontrado.' });
    }
  }
  const fe = error as FastifyError;
  if (fe.statusCode === 429) {
    return reply.status(429).send({ error: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
  }
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    return reply.status(fe.statusCode).send({ error: fe.code ?? 'BAD_REQUEST', message: fe.message });
  }
  request.log.error({ err: error }, 'Erro inesperado');
  return reply.status(500).send({ error: 'INTERNAL', message: 'Erro interno. Tente novamente em instantes.' });
}
