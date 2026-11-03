import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ORDER_STATUS_LABELS, QUOTE_STATUS_LABELS, formatBRL, formatDateBR } from '@della/shared';
import { prisma } from '../../db';
import { emailEnabled, whatsappApiEnabled } from '../../config';
import { actor, requireAuth } from '../../lib/auth';
import { audit } from '../../lib/audit';
import { AppError, notFound, unprocessable } from '../../lib/errors';
import { getSettings } from '../../lib/settings';
import { getFile, putFile } from '../../lib/storage';
import { fromDbDate } from '../../lib/validation';
import { docScopeForRep } from '../commercial/access';
import { sendMail } from './mailer';
import { addressLine, renderPdf, type PdfData } from './pdf';

export type PdfRenderer = (data: PdfData) => Promise<Buffer>;

type Kind = 'orders' | 'quotes';

/** Verifica se o usuário pode acessar o pedido/orçamento (admin: todos; vendedor: os seus, salvo permissão). */
async function loadDoc(req: FastifyRequest, kind: Kind, id: string) {
  const scope = req.user!.role === 'ADMIN' ? {} : docScopeForRep(req.rep!);
  const include = {
    client: true,
    salesRep: { select: { fullName: true, phone: true, contactPhone: true, email: true } },
    items: { orderBy: { position: 'asc' as const } },
  };
  const doc =
    kind === 'orders'
      ? await prisma.order.findFirst({ where: { id, ...scope }, include })
      : await prisma.quote.findFirst({ where: { id, ...scope }, include });
  if (!doc) throw notFound(kind === 'orders' ? 'Pedido' : 'Orçamento');
  return doc;
}

async function buildPdfData(kind: Kind, doc: Awaited<ReturnType<typeof loadDoc>>): Promise<PdfData> {
  const s = await getSettings();
  const snap = (doc.calcSnapshot ?? {}) as { surcharges?: { name: string; amountCents: number }[] };
  const isOrder = kind === 'orders';
  const status = doc.status as string;
  return {
    kind: isOrder ? 'ORDER' : 'QUOTE',
    number: (doc.number as string | null) ?? 'RASCUNHO',
    status,
    statusLabel: isOrder ? ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] : QUOTE_STATUS_LABELS[status as keyof typeof QUOTE_STATUS_LABELS],
    issueDate: fromDbDate('orderDate' in doc ? doc.orderDate : (doc as { quoteDate: Date }).quoteDate)!,
    validUntil: 'validUntil' in doc ? fromDbDate(doc.validUntil as Date) : null,
    expectedDelivery: fromDbDate(doc.expectedDelivery),
    paymentTerm: doc.paymentTermName,
    paymentDays: doc.paymentDays,
    notes: doc.notes,
    company: {
      name: s.companyName,
      legalName: s.legalName,
      cnpj: s.cnpj,
      stateRegistration: s.stateRegistration,
      phone: s.phone,
      email: s.email,
      website: s.website,
      address: s.address,
      logo: s.logoFileName ? (await getFile('company', s.logoFileName).catch(() => null))?.data ?? null : null,
      footerText: s.pdfFooterText,
      quoteTerms: s.quoteTerms,
      timezone: s.timezone,
    },
    client: {
      legalName: doc.client.legalName,
      tradeName: doc.client.tradeName,
      cnpj: doc.client.cnpj,
      stateRegistration: doc.client.stateRegistration,
      responsibleName: doc.client.responsibleName,
      commercialPhone: doc.client.commercialPhone,
      commercialEmail: doc.client.commercialEmail,
      address: addressLine(doc.client),
    },
    // somente nome e contato comercial do vendedor (sem CPF)
    seller: { name: doc.salesRep.fullName, phone: doc.salesRep.contactPhone ?? doc.salesRep.phone, email: doc.salesRep.email },
    items: doc.items.map((i) => ({
      sku: i.sku,
      name: i.productName,
      brand: i.brandName,
      unit: i.unit,
      saleUnit: i.saleUnit,
      unitsPerSaleUnit: i.unitsPerSaleUnit,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      discountBps: i.discountBps,
      discountCents: i.discountCents,
      netBeforeGeneralCents: i.grossCents - i.discountCents,
    })),
    totals: {
      grossCents: doc.grossCents,
      itemDiscountCents: doc.itemDiscountCents,
      generalDiscountBps: doc.generalDiscountBps,
      generalDiscountCents: doc.generalDiscountCents,
      surcharges: (snap.surcharges ?? []).map((x) => ({ name: x.name, amountCents: x.amountCents })),
      freightCents: doc.freightCents,
      totalCents: doc.totalCents,
      totalQuantity: doc.totalQuantity,
    },
  };
}

function shareMessage(kind: Kind, number: string, totalCents: number, validUntil?: string | null) {
  if (kind === 'quotes') {
    return `Olá! Segue o orçamento nº ${number}, referente aos produtos solicitados. Valor total: ${formatBRL(totalCents)}.${validUntil ? ` Proposta válida até ${formatDateBR(validUntil)}.` : ''} Qualquer dúvida, estou à disposição.`;
  }
  return `Olá! Segue o pedido nº ${number}, referente aos produtos solicitados. Valor total: ${formatBRL(totalCents)}. Qualquer dúvida, estou à disposição.`;
}

export function documentRoutes(renderer: PdfRenderer = renderPdf) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', requireAuth);

    app.get('/integrations', async () => ({ email: emailEnabled, whatsappApi: whatsappApiEnabled, whatsappLink: true }));

    app.get('/:kind/:id', async (req) => {
      const { kind, id } = z.object({ kind: z.enum(['orders', 'quotes']), id: z.string().uuid() }).parse(req.params);
      const doc = await loadDoc(req, kind, id);
      const documents = await prisma.generatedDocument.findMany({
        where: kind === 'orders' ? { orderId: id } : { quoteId: id },
        orderBy: { version: 'desc' },
        include: { generatedBy: { select: { name: true } } },
      });
      return {
        documents,
        shareMessage: shareMessage(kind, doc.number ?? 'RASCUNHO', doc.totalCents, 'validUntil' in doc ? fromDbDate(doc.validUntil as Date) : null),
      };
    });

    /**
     * Gera (ou gera novamente) o PDF. Esta operação NUNCA cria ou altera o pedido/orçamento:
     * uma falha aqui pode ser repetida com segurança, sem risco de duplicação.
     */
    app.post('/:kind/:id', async (req, reply) => {
      const { kind, id } = z.object({ kind: z.enum(['orders', 'quotes']), id: z.string().uuid() }).parse(req.params);
      const doc = await loadDoc(req, kind, id);
      if (kind === 'quotes' && doc.discountApprovalStatus === 'PENDING') {
        throw unprocessable('O desconto deste orçamento aguarda aprovação. Gere o PDF após a decisão do administrador.', 'APPROVAL_PENDING');
      }
      const data = await buildPdfData(kind, doc);
      let pdf: Buffer;
      try {
        pdf = await renderer(data);
      } catch (err) {
        req.log.error({ err }, 'Falha ao gerar PDF');
        throw new AppError(502, 'Não foi possível gerar o PDF agora. O registro foi preservado — tente novamente.', 'PDF_FAILED');
      }
      const sha256 = crypto.createHash('sha256').update(pdf).digest('hex');
      const created = await prisma.$transaction(async (tx) => {
        const { fileName } = await putFile('documents', pdf, 'pdf', 'application/pdf', tx);
        const last = await tx.generatedDocument.findFirst({ where: kind === 'orders' ? { orderId: id } : { quoteId: id }, orderBy: { version: 'desc' } });
        const gd = await tx.generatedDocument.create({
          data: {
            kind: kind === 'orders' ? 'ORDER_PDF' : 'QUOTE_PDF',
            orderId: kind === 'orders' ? id : null,
            quoteId: kind === 'quotes' ? id : null,
            version: (last?.version ?? 0) + 1,
            fileName,
            sha256,
            sizeBytes: pdf.length,
            generatedById: req.user!.id,
          },
        });
        await audit(tx, actor(req), 'DOCUMENT_GENERATED', kind === 'orders' ? 'order' : 'quote', id, { documentId: gd.id, version: gd.version, sha256 });
        return gd;
      });
      return reply.status(201).send({
        document: created,
        fileName: `${kind === 'orders' ? 'Pedido' : 'Orcamento'}-${data.number}.pdf`,
        shareMessage: shareMessage(kind, data.number, data.totals.totalCents, data.validUntil),
      });
    });

    app.get('/file/:docId', async (req, reply) => {
      const { docId } = z.object({ docId: z.string().uuid() }).parse(req.params);
      const { download } = z.object({ download: z.string().optional() }).parse(req.query);
      const gd = await prisma.generatedDocument.findUnique({ where: { id: docId } });
      if (!gd) throw notFound('Documento');
      const kind: Kind = gd.orderId ? 'orders' : 'quotes';
      const doc = await loadDoc(req, kind, (gd.orderId ?? gd.quoteId)!); // valida permissão
      const file = await getFile('documents', gd.fileName).catch(() => {
        throw new AppError(410, 'Arquivo não encontrado no armazenamento. Gere o PDF novamente.', 'FILE_MISSING');
      });
      const name = `${kind === 'orders' ? 'Pedido' : 'Orcamento'}-${doc.number ?? 'RASCUNHO'}-v${gd.version}.pdf`;
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name}"`);
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(file.data);
    });

    app.post('/file/:docId/email', async (req) => {
      const { docId } = z.object({ docId: z.string().uuid() }).parse(req.params);
      const b = z.object({ to: z.string().trim().email('E-mail inválido.'), message: z.string().trim().max(2000).optional() }).parse(req.body);
      const gd = await prisma.generatedDocument.findUnique({ where: { id: docId } });
      if (!gd) throw notFound('Documento');
      const kind: Kind = gd.orderId ? 'orders' : 'quotes';
      const doc = await loadDoc(req, kind, (gd.orderId ?? gd.quoteId)!);
      const number = doc.number ?? 'RASCUNHO';
      const content = (await getFile('documents', gd.fileName)).data;
      const res = await sendMail({
        to: b.to,
        subject: `${kind === 'orders' ? 'Pedido' : 'Orçamento'} nº ${number}`,
        text: b.message || shareMessage(kind, number, doc.totalCents, 'validUntil' in doc ? fromDbDate(doc.validUntil as Date) : null),
        attachments: [{ filename: `${kind === 'orders' ? 'Pedido' : 'Orcamento'}-${number}.pdf`, content }],
      });
      await audit(prisma, actor(req), 'DOCUMENT_EMAILED', kind === 'orders' ? 'order' : 'quote', doc.id, { documentId: docId, to: b.to });
      return { sent: true, messageId: res.messageId };
    });
  };
}
