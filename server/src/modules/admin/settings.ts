import type { FastifyInstance } from 'fastify';
import type { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { DEFAULT_ORDER_TRANSITIONS, ORDER_STATUSES, ORDER_TERMINAL_STATUSES } from '@della/shared';
import { prisma } from '../../db';
import { actor } from '../../lib/auth';
import { audit, diff } from '../../lib/audit';
import { AppError, conflict, notFound, unprocessable } from '../../lib/errors';
import { removeFile, saveImage } from '../../lib/storage';
import { getSettings } from '../../lib/settings';
import { bpsSchema, emailOpt, optText, phoneOpt, reqText } from '../../lib/validation';
import { emailEnabled, whatsappApiEnabled } from '../../config';

const settingsSchema = z.object({
  companyName: reqText(120),
  legalName: optText(200),
  cnpj: optText(20),
  stateRegistration: optText(30),
  phone: phoneOpt,
  email: emailOpt,
  website: optText(200),
  address: optText(300),
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Fuso horário inválido.')
    .default('America/Sao_Paulo'),
  quoteValidityDays: z.number().int().min(1).max(365),
  pdfFooterText: optText(1000),
  quoteTerms: optText(2000),
  allowItemDiscount: z.boolean(),
  allowSellerFreight: z.boolean(),
  conversionPricePolicy: z.enum(['KEEP_QUOTE_PRICES', 'USE_CURRENT_PRICES']),
  stockEnabled: z.boolean(),
  stockPolicy: z.enum(['ON_CONFIRM', 'ON_APPROVAL', 'ON_PICKING', 'ON_SHIPMENT']),
  blockOnInsufficientStock: z.boolean(),
  orderNumberPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'Prefixo: 2 a 6 letras.'),
  quoteNumberPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'Prefixo: 2 a 6 letras.'),
});

const ruleSchema = z
  .object({
    name: reqText(80),
    description: optText(500),
    kind: z.enum(['SURCHARGE', 'INTERNAL_ESTIMATE']),
    base: z.enum(['GROSS', 'NET']),
    scope: z.enum(['ALL', 'BRAND', 'CATEGORY', 'PRODUCT']),
    rateBps: bpsSchema,
    brandId: z.string().uuid().nullish().transform((v) => v ?? null),
    categoryId: z.string().uuid().nullish().transform((v) => v ?? null),
    productId: z.string().uuid().nullish().transform((v) => v ?? null),
    active: z.boolean().default(true),
  })
  .superRefine((r, ctx) => {
    if (r.scope === 'BRAND' && !r.brandId) ctx.addIssue({ code: 'custom', path: ['brandId'], message: 'Selecione a marca.' });
    if (r.scope === 'CATEGORY' && !r.categoryId) ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Selecione a categoria.' });
    if (r.scope === 'PRODUCT' && !r.productId) ctx.addIssue({ code: 'custom', path: ['productId'], message: 'Selecione o produto.' });
  })
  .transform((r) => ({
    ...r,
    brandId: r.scope === 'BRAND' ? r.brandId : null,
    categoryId: r.scope === 'CATEGORY' ? r.categoryId : null,
    productId: r.scope === 'PRODUCT' ? r.productId : null,
  }));

const termSchema = z.object({
  name: reqText(80),
  days: optText(60),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function adminSettingsRoutes(app: FastifyInstance) {
  app.get('/settings', async () => ({
    ...(await getSettings()),
    integrations: { email: emailEnabled, whatsappApi: whatsappApiEnabled },
  }));

  app.put('/settings', async (req) => {
    const data = settingsSchema.parse(req.body);
    const before = await getSettings();
    const s = await prisma.companySettings.update({ where: { id: 1 }, data: { ...data, updatedById: req.user!.id } });
    await audit(prisma, actor(req), 'SETTINGS_UPDATED', 'company_settings', '1', diff(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>));
    return s;
  });

  app.post('/settings/logo', async (req) => {
    if (!req.isMultipart()) throw new AppError(400, 'Envie o logotipo como multipart/form-data.');
    const file = await req.file();
    if (!file) throw unprocessable('Nenhum arquivo recebido.');
    const buf = await file.toBuffer();
    const { fileName } = await saveImage('company', buf);
    if (fileName.endsWith('.webp')) {
      await removeFile('company', fileName);
      throw new AppError(415, 'Para o PDF, envie o logotipo em PNG ou JPG.', 'BAD_FILE_TYPE');
    }
    const before = await getSettings();
    await prisma.companySettings.update({ where: { id: 1 }, data: { logoFileName: fileName } });
    if (before.logoFileName) await removeFile('company', before.logoFileName);
    await audit(prisma, actor(req), 'LOGO_UPDATED', 'company_settings', '1');
    return { logoFileName: fileName };
  });

  app.delete('/settings/logo', async (req) => {
    const s = await getSettings();
    if (s.logoFileName) {
      await prisma.companySettings.update({ where: { id: 1 }, data: { logoFileName: null } });
      await removeFile('company', s.logoFileName);
      await audit(prisma, actor(req), 'LOGO_REMOVED', 'company_settings', '1');
    }
    return { ok: true };
  });

  // ------------- Condições de pagamento -------------
  app.get('/payment-terms', async () => prisma.paymentTerm.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }));
  app.post('/payment-terms', async (req, reply) => {
    const data = termSchema.parse(req.body);
    if (await prisma.paymentTerm.findUnique({ where: { name: data.name } })) throw conflict('Já existe uma condição com este nome.');
    const t = await prisma.paymentTerm.create({ data });
    await audit(prisma, actor(req), 'PAYMENT_TERM_CREATED', 'payment_term', t.id, data);
    return reply.status(201).send(t);
  });
  app.put('/payment-terms/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = termSchema.parse(req.body);
    if (await prisma.paymentTerm.findFirst({ where: { name: data.name, id: { not: id } } })) throw conflict('Já existe uma condição com este nome.');
    const t = await prisma.paymentTerm.update({ where: { id }, data });
    await audit(prisma, actor(req), 'PAYMENT_TERM_UPDATED', 'payment_term', id, data);
    return t;
  });

  // ------------- Regras de tributos / acréscimos -------------
  app.get('/pricing-rules', async () =>
    prisma.pricingRule.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { brand: { select: { name: true } }, category: { select: { name: true } }, product: { select: { sku: true, name: true } } },
    }),
  );
  app.post('/pricing-rules', async (req, reply) => {
    const data = ruleSchema.parse(req.body);
    const r = await prisma.pricingRule.create({ data });
    await audit(prisma, actor(req), 'PRICING_RULE_CREATED', 'pricing_rule', r.id, data);
    return reply.status(201).send(r);
  });
  app.put('/pricing-rules/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = ruleSchema.parse(req.body);
    const before = await prisma.pricingRule.findUnique({ where: { id } });
    if (!before) throw notFound('Regra');
    const r = await prisma.pricingRule.update({ where: { id }, data });
    await audit(prisma, actor(req), 'PRICING_RULE_UPDATED', 'pricing_rule', id, diff(before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>));
    return r;
  });

  // ------------- Transições de status -------------
  app.get('/status-transitions', async () => {
    const rows = await prisma.orderStatusTransition.findMany();
    return { transitions: rows.map((r) => [r.fromStatus, r.toStatus]), defaults: DEFAULT_ORDER_TRANSITIONS };
  });
  app.put('/status-transitions', async (req) => {
    const statusEnum = z.enum(ORDER_STATUSES);
    const { transitions } = z.object({ transitions: z.array(z.tuple([statusEnum, statusEnum])).max(200) }).parse(req.body);
    for (const [from, to] of transitions) {
      if (from === 'DRAFT' || to === 'DRAFT') throw unprocessable('Rascunho não participa das transições administrativas.');
      if (ORDER_TERMINAL_STATUSES.includes(from)) throw unprocessable('Status finais (concluído, cancelado, reprovado) só podem ser alterados por reabertura com justificativa.');
      if (from === to) throw unprocessable('Transição inválida.');
    }
    await prisma.$transaction(async (tx) => {
      await tx.orderStatusTransition.deleteMany({});
      await tx.orderStatusTransition.createMany({
        data: transitions.map(([fromStatus, toStatus]) => ({ fromStatus: fromStatus as OrderStatus, toStatus: toStatus as OrderStatus })),
        skipDuplicates: true,
      });
      await audit(tx, actor(req), 'STATUS_TRANSITIONS_UPDATED', 'order_status_transitions', null, { transitions });
    });
    return { ok: true };
  });
}
