import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { inflateSync } from 'node:zlib';
import { Agent, key, loginAdmin, loginAna, loginVictor, makeApp, prisma, seedBase, VICTOR, type Fixtures } from './helpers';

let app: FastifyInstance;
let fx: Fixtures;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  fx = await seedBase();
});

/** Extrai o texto bruto (descomprimido) de um PDF gerado pelo pdfkit para inspeção. */
function pdfText(buf: Buffer) {
  const s = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(s))) {
    try {
      out += inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      /* fonte/imagem */
    }
  }
  // o pdfkit escreve o texto em arrays TJ com trechos <hex> separados por ajustes de kerning
  const texts: string[] = [];
  for (const arr of out.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    texts.push([...arr[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join(''));
  }
  return texts.join('\n');
}

async function makeOrder(victor: Agent) {
  const r = await victor.post('/api/seller/orders', {
    idempotencyKey: key(),
    action: 'CONFIRM',
    clientId: fx.clientVictor,
    paymentTermId: fx.termId,
    items: [{ productId: fx.p1, quantity: 3 }, { productId: fx.p3, quantity: 1 }],
    generalDiscountBps: 500,
    notes: 'Observação comercial do pedido',
  });
  return r.body.order;
}

describe('Geração de PDF', () => {
  it('textos com caracteres fora da fonte do PDF (emojis, sinal de menos) são saneados', async () => {
    const { pdfSafeText, renderPdf } = await import('../src/modules/documents/pdf');
    expect(pdfSafeText('Entrega rápida 🚚 − ok “sim” – ção')).toBe('Entrega rápida  - ok “sim” – ção');
    const victor = await loginVictor(app);
    const r = await victor.post('/api/seller/orders', { idempotencyKey: key(), action: 'CONFIRM', clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 1 }], notes: 'Urgente 🔥 ✅ − entregar 08h' });
    const g = await victor.post(`/api/documents/orders/${r.body.order.id}`);
    expect(g.status).toBe(201);
    expect(typeof renderPdf).toBe('function');
  });

  it('gera, lista, visualiza e baixa o PDF do pedido', async () => {
    const victor = await loginVictor(app);
    const o = await makeOrder(victor);
    const g = await victor.post(`/api/documents/orders/${o.id}`);
    expect(g.status).toBe(201);
    expect(g.body.document.version).toBe(1);
    expect(g.body.shareMessage).toContain(`pedido nº ${o.number}`);
    expect(g.body.shareMessage).toContain('R$ 1.235,00');
    const view = await victor.get(`/api/documents/file/${g.body.document.id}`);
    expect(view.status).toBe(200);
    expect(view.headers['content-type']).toBe('application/pdf');
    expect(String(view.headers['content-disposition'])).toMatch(/^inline/);
    expect(view.raw.subarray(0, 5).toString()).toBe('%PDF-');
    const dl = await victor.get(`/api/documents/file/${g.body.document.id}?download=1`);
    expect(String(dl.headers['content-disposition'])).toMatch(/^attachment; filename="Pedido-PED-/);
    // gerar novamente cria nova versão vinculada
    const g2 = await victor.post(`/api/documents/orders/${o.id}`);
    expect(g2.body.document.version).toBe(2);
    expect((await victor.get(`/api/documents/orders/${o.id}`)).body.documents).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: 'DOCUMENT_GENERATED' } })).toBe(2);
  });

  it('PDF do cliente não contém custo, margem nem CPF do vendedor', async () => {
    const victor = await loginVictor(app);
    const o = await makeOrder(victor);
    const g = await victor.post(`/api/documents/orders/${o.id}`);
    const pdf = (await victor.get(`/api/documents/file/${g.body.document.id}`)).raw;
    const text = pdfText(pdf);
    expect(text).toContain('PEDIDO DE VENDA');
    expect(text).toContain('Produto 001');
    expect(text).toContain('1.235,00');
    expect(text).not.toMatch(/[Cc]usto|[Mm]argem|[Ll]ucro/);
    expect(text).not.toContain('529.982.247-25');
    expect(text).not.toContain('52998224725');
    expect(text).not.toContain('600,00'); // custo unitário do produto 001 é 60,00 (3 un = 180,00)
  });

  it('orçamento é identificado como proposta, não como pedido', async () => {
    const victor = await loginVictor(app);
    const q = (await victor.post('/api/seller/quotes', { idempotencyKey: key(), clientId: fx.clientVictor, items: [{ productId: fx.p1, quantity: 1 }] })).body.quote;
    const g = await victor.post(`/api/documents/quotes/${q.id}`);
    const text = pdfText((await victor.get(`/api/documents/file/${g.body.document.id}`)).raw);
    expect(text).toContain('PROPOSTA COMERCIAL');
    expect(text).toContain('não constitui pedido confirmado');
    expect(text).not.toContain('PEDIDO DE VENDA');
    expect(g.body.shareMessage).toMatch(/^Olá! Segue o orçamento nº ORC-/);
  });

  it('falha na geração do PDF não duplica o pedido e pode ser repetida', async () => {
    let fail = true;
    const flaky = await makeApp({
      pdfRenderer: async (d) => {
        if (fail) throw new Error('falha simulada');
        const { renderPdf } = await import('../src/modules/documents/pdf');
        return renderPdf(d);
      },
    });
    try {
      const victor = new Agent(flaky);
      await victor.login(VICTOR.username, VICTOR.initial);
      await victor.post('/api/auth/change-password', { currentPassword: VICTOR.initial, newPassword: VICTOR.password });
      const body = {
        idempotencyKey: key(),
        action: 'CONFIRM',
        clientId: fx.clientVictor,
        items: [{ productId: fx.p1, quantity: 1 }],
      };
      const o = (await victor.post('/api/seller/orders', body)).body.order;
      const g1 = await victor.post(`/api/documents/orders/${o.id}`);
      expect(g1.status).toBe(502);
      expect(g1.body.error).toBe('PDF_FAILED');
      // usuário clica em "confirmar" de novo (reenvio): continua um único pedido
      const again = await victor.post('/api/seller/orders', body);
      expect(again.body.duplicate).toBe(true);
      fail = false;
      const g2 = await victor.post(`/api/documents/orders/${o.id}`);
      expect(g2.status).toBe(201);
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.generatedDocument.count()).toBe(1);
    } finally {
      await flaky.close();
    }
  });

  it('e-mail sem SMTP configurado informa claramente que não foi enviado', async () => {
    const victor = await loginVictor(app);
    const o = await makeOrder(victor);
    const g = await victor.post(`/api/documents/orders/${o.id}`);
    const e = await victor.post(`/api/documents/file/${g.body.document.id}/email`, { to: 'cliente@exemplo.com' });
    expect(e.status).toBe(503);
    expect(e.body.error).toBe('EMAIL_NOT_CONFIGURED');
  });

  it('outro vendedor não acessa o PDF; administrador acessa', async () => {
    const victor = await loginVictor(app);
    const o = await makeOrder(victor);
    const g = await victor.post(`/api/documents/orders/${o.id}`);
    const ana = await loginAna(app);
    expect((await ana.get(`/api/documents/file/${g.body.document.id}`)).status).toBe(404);
    expect((await ana.post(`/api/documents/orders/${o.id}`)).status).toBe(404);
    const admin = await loginAdmin(app);
    expect((await admin.get(`/api/documents/file/${g.body.document.id}`)).status).toBe(200);
  });
});
