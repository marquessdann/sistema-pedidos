import PDFDocument from 'pdfkit';
import { formatBRL, formatBps, formatCep, formatCnpj, formatDateBR, formatDateTimeBR, formatPhone } from '@della/shared';

/**
 * Dados do PDF destinado ao CLIENTE.
 * Esta estrutura propositalmente NÃO possui campos de custo, margem, lucro ou tributos internos,
 * nem CPF do vendedor — eles não podem ser incluídos por engano.
 */
export interface PdfData {
  kind: 'ORDER' | 'QUOTE';
  number: string;
  status: string;
  statusLabel: string;
  issueDate: string; // YYYY-MM-DD
  validUntil?: string | null;
  expectedDelivery?: string | null;
  paymentTerm?: string | null;
  paymentDays?: string | null;
  notes?: string | null;
  company: {
    name: string;
    legalName?: string | null;
    cnpj?: string | null;
    stateRegistration?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
    logoPath?: string | null;
    footerText?: string | null;
    quoteTerms?: string | null;
    timezone: string;
  };
  client: {
    legalName: string;
    tradeName?: string | null;
    cnpj: string;
    stateRegistration?: string | null;
    responsibleName?: string | null;
    commercialPhone?: string | null;
    commercialEmail?: string | null;
    address?: string | null;
  };
  seller: { name: string; phone?: string | null; email?: string | null };
  items: {
    sku: string;
    name: string;
    brand: string;
    unit: string;
    quantity: number;
    unitPriceCents: number;
    discountBps: number;
    discountCents: number;
    netBeforeGeneralCents: number;
  }[];
  totals: {
    grossCents: number;
    itemDiscountCents: number;
    generalDiscountBps: number;
    generalDiscountCents: number;
    surcharges: { name: string; amountCents: number }[];
    freightCents: number;
    totalCents: number;
    totalQuantity: number;
  };
}

const NAVY = '#0F2341';
const GOLD = '#B8913A';
const GRAY = '#5B6575';
const LIGHT = '#F3F5F8';
const BORDER = '#D9DEE6';

export function addressLine(a: { street?: string | null; number?: string | null; complement?: string | null; district?: string | null; city?: string | null; state?: string | null; cep?: string | null }) {
  const first = [a.street, a.number].filter(Boolean).join(', ');
  const parts = [first + (a.complement ? ` – ${a.complement}` : ''), a.district, [a.city, a.state].filter(Boolean).join('/'), a.cep ? `CEP ${formatCep(a.cep)}` : null];
  return parts.filter((p) => p && p.trim()).join(' • ');
}

// caracteres suportados pelas fontes padrão do PDF (WinAnsi): Latin-1 + extras do cp1252
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACEMENTS: Record<string, string> = { '\u2212': '-', '\u2010': '-', '\u2011': '-', '\u00a0': ' ', '\u202f': ' ', '\u2007': ' ' };

/** Troca caracteres que a fonte do PDF não consegue desenhar (ex.: emojis) para evitar texto corrompido. */
export function pdfSafeText(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (REPLACEMENTS[ch]) out += REPLACEMENTS[ch];
    else if (ch === '\n' || ch === '\t') out += ch;
    else {
      const c = ch.codePointAt(0)!;
      out += (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch) ? ch : '';
    }
  }
  return out;
}

function sanitize<T>(v: T): T {
  if (typeof v === 'string') return pdfSafeText(v) as T;
  if (Array.isArray(v)) return v.map(sanitize) as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'logoPath' ? x : sanitize(x)])) as T;
  }
  return v;
}

export function renderPdf(input: PdfData): Promise<Buffer> {
  const data = sanitize(input);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 60, left: 40, right: 40 },
      bufferPages: true,
      info: {
        Title: `${data.kind === 'QUOTE' ? 'Orçamento' : 'Pedido'} ${data.number}`,
        Author: data.company.name,
        Creator: 'Sistema de Pedidos Della',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      draw(doc, data);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function draw(doc: PDFKit.PDFDocument, d: PdfData) {
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  const isQuote = d.kind === 'QUOTE';

  // ---------- Cabeçalho ----------
  let y = 36;
  let logoDrawn = false;
  if (d.company.logoPath) {
    try {
      doc.image(d.company.logoPath, L, y, { fit: [150, 54] });
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    doc.font('Helvetica-Bold').fontSize(26).fillColor(NAVY).text(d.company.name.toUpperCase(), L, y + 6, { width: 220, characterSpacing: 3 });
    doc.rect(L, y + 40, 46, 3).fill(GOLD);
  }
  const companyLines = [
    d.company.legalName,
    d.company.cnpj ? `CNPJ ${formatCnpj(d.company.cnpj)}${d.company.stateRegistration ? ` • IE ${d.company.stateRegistration}` : ''}` : null,
    d.company.address,
    [d.company.phone ? formatPhone(d.company.phone) : null, d.company.email].filter(Boolean).join(' • ') || null,
    d.company.website,
  ].filter(Boolean) as string[];
  doc.font('Helvetica').fontSize(8).fillColor(GRAY);
  doc.text(companyLines.join('\n'), L + 240, y + 2, { width: W - 240, align: 'right', lineGap: 1.5 });
  y = 104;

  // ---------- Faixa de título ----------
  doc.rect(L, y, W, 34).fill(NAVY);
  doc.rect(L, y + 34, W, 2.5).fill(GOLD);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF');
  doc.text(isQuote ? 'ORÇAMENTO • PROPOSTA COMERCIAL' : 'PEDIDO DE VENDA', L + 14, y + 11, { width: W / 2 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text(`Nº ${d.number}`, L + W / 2, y + 11, { width: W / 2 - 14, align: 'right' });
  y += 44;

  // aviso de natureza do documento
  let notice: string | null = null;
  let noticeColor = GOLD;
  if (isQuote) {
    notice = `Esta proposta não constitui pedido confirmado.${d.validUntil ? ` Válida até ${formatDateBR(d.validUntil)}.` : ''}`;
    if (d.status === 'EXPIRED') notice = 'PROPOSTA EXPIRADA – valores sujeitos a revisão.';
    if (d.status === 'REJECTED') notice = 'PROPOSTA RECUSADA.';
  } else if (d.status === 'DRAFT') {
    notice = 'RASCUNHO – este pedido ainda NÃO foi confirmado.';
    noticeColor = '#B42318';
  } else if (d.status === 'PENDING_APPROVAL') {
    notice = 'Pedido registrado, aguardando aprovação comercial.';
  } else if (d.status === 'CANCELLED' || d.status === 'REJECTED') {
    notice = `PEDIDO ${d.status === 'CANCELLED' ? 'CANCELADO' : 'REPROVADO'} – sem validade comercial.`;
    noticeColor = '#B42318';
  }
  if (notice) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(noticeColor).text(notice, L, y, { width: W });
    y = doc.y + 6;
  }

  // ---------- Caixas cliente / documento ----------
  const boxW = (W - 12) / 2;
  const clientLines: [string, string | null | undefined][] = [
    ['Razão social', d.client.legalName],
    ['Nome fantasia', d.client.tradeName],
    ['CNPJ', formatCnpj(d.client.cnpj) + (d.client.stateRegistration ? `   IE ${d.client.stateRegistration}` : '')],
    ['Endereço', d.client.address],
    ['Responsável', d.client.responsibleName],
    ['Contato', [d.client.commercialPhone ? formatPhone(d.client.commercialPhone) : null, d.client.commercialEmail].filter(Boolean).join(' • ')],
  ];
  const docLines: [string, string | null | undefined][] = [
    ['Data de emissão', formatDateBR(d.issueDate)],
    ['Situação', d.statusLabel],
    ...(isQuote ? ([['Validade da proposta', d.validUntil ? formatDateBR(d.validUntil) : null]] as [string, string | null][]) : []),
    ['Condição de pagamento', [d.paymentTerm, d.paymentDays ? `(${d.paymentDays} dias)` : null].filter(Boolean).join(' ') || null],
    ['Previsão de entrega', d.expectedDelivery ? formatDateBR(d.expectedDelivery) : null],
    ['Vendedor', d.seller.name],
    ['Contato do vendedor', [d.seller.phone ? formatPhone(d.seller.phone) : null, d.seller.email].filter(Boolean).join(' • ')],
  ];
  const h1 = infoBox(doc, L, y, boxW, 'CLIENTE', clientLines, true);
  const h2 = infoBox(doc, L + boxW + 12, y, boxW, isQuote ? 'DADOS DA PROPOSTA' : 'DADOS DO PEDIDO', docLines, true);
  const boxH = Math.max(h1, h2);
  infoBox(doc, L, y, boxW, 'CLIENTE', clientLines, false, boxH);
  infoBox(doc, L + boxW + 12, y, boxW, isQuote ? 'DADOS DA PROPOSTA' : 'DADOS DO PEDIDO', docLines, false, boxH);
  y += boxH + 14;

  // ---------- Tabela de itens ----------
  const cols = [
    { key: 'sku', label: 'Código', w: 62, align: 'left' as const },
    { key: 'name', label: 'Produto', w: 0, align: 'left' as const },
    { key: 'brand', label: 'Marca', w: 66, align: 'left' as const },
    { key: 'qty', label: 'Qtd.', w: 38, align: 'right' as const },
    { key: 'unit', label: 'Vlr. unit.', w: 62, align: 'right' as const },
    { key: 'disc', label: 'Desc.', w: 40, align: 'right' as const },
    { key: 'sub', label: 'Subtotal', w: 70, align: 'right' as const },
  ];
  cols[1].w = W - cols.reduce((a, c) => a + c.w, 0);

  const header = () => {
    doc.rect(L, y, W, 18).fill(LIGHT);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NAVY);
    let x = L;
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + 4, y + 6, { width: c.w - 8, align: c.align });
      x += c.w;
    }
    y += 18;
  };
  header();
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 10;

  d.items.forEach((it, idx) => {
    const cells: Record<string, string> = {
      sku: it.sku,
      name: `${it.name}${it.unit ? `  (${it.unit})` : ''}`,
      brand: it.brand,
      qty: it.quantity.toLocaleString('pt-BR'),
      unit: formatBRL(it.unitPriceCents),
      disc: it.discountBps ? formatBps(it.discountBps, it.discountBps % 100 === 0 ? 0 : 2) : '—',
      sub: formatBRL(it.netBeforeGeneralCents),
    };
    doc.font('Helvetica').fontSize(8);
    const rowH = Math.max(...cols.map((c) => doc.heightOfString(cells[c.key], { width: c.w - 8 }))) + 9;
    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
    if (idx % 2 === 1) doc.rect(L, y, W, rowH).fill('#FAFBFC');
    let x = L;
    doc.fillColor('#1F2937');
    for (const c of cols) {
      doc.font(c.key === 'sub' ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor('#1F2937');
      doc.text(cells[c.key], x + 4, y + 4.5, { width: c.w - 8, align: c.align });
      x += c.w;
    }
    doc.moveTo(L, y + rowH).lineTo(R, y + rowH).lineWidth(0.5).strokeColor(BORDER).stroke();
    y += rowH;
  });

  // ---------- Totais ----------
  const t = d.totals;
  const totalRows: [string, string, boolean?][] = [[`Subtotal bruto (${t.totalQuantity.toLocaleString('pt-BR')} un.)`, formatBRL(t.grossCents)]];
  if (t.itemDiscountCents) totalRows.push(['Descontos nos itens', `- ${formatBRL(t.itemDiscountCents)}`]);
  if (t.generalDiscountCents) totalRows.push([`Desconto comercial (${formatBps(t.generalDiscountBps)})`, `- ${formatBRL(t.generalDiscountCents)}`]);
  for (const s of t.surcharges) totalRows.push([s.name, `+ ${formatBRL(s.amountCents)}`]);
  if (t.freightCents) totalRows.push(['Frete', `+ ${formatBRL(t.freightCents)}`]);
  const totalsH = totalRows.length * 15 + 32;
  if (y + totalsH + 20 > bottomLimit) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += 12;
  const tx = R - 240;
  doc.font('Helvetica').fontSize(8.5);
  for (const [label, value] of totalRows) {
    doc.fillColor(GRAY).text(label, tx, y, { width: 150 });
    doc.fillColor('#1F2937').text(value, tx + 150, y, { width: 90, align: 'right' });
    y += 15;
  }
  doc.rect(tx, y + 2, 240, 26).fill(NAVY);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF').text(isQuote ? 'VALOR TOTAL DA PROPOSTA' : 'VALOR TOTAL DO PEDIDO', tx + 10, y + 10, { width: 140 });
  doc.fontSize(12).fillColor('#FFFFFF').text(formatBRL(t.totalCents), tx + 130, y + 9, { width: 100, align: 'right' });
  doc.rect(tx, y + 28, 240, 2).fill(GOLD);
  y += 44;

  // ---------- Observações e condições ----------
  const textBlock = (title: string, body: string) => {
    doc.font('Helvetica').fontSize(8.5);
    const h = doc.heightOfString(body, { width: W }) + 20;
    if (y + h > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(title, L, y);
    doc.font('Helvetica').fontSize(8.5).fillColor('#1F2937').text(body, L, y + 13, { width: W, lineGap: 1.5 });
    y = doc.y + 12;
  };
  if (d.notes) textBlock('OBSERVAÇÕES', d.notes);
  if (isQuote && d.company.quoteTerms) textBlock('CONDIÇÕES DA PROPOSTA', d.company.quoteTerms);

  // ---------- Rodapé em todas as páginas ----------
  const range = doc.bufferedPageRange();
  const generated = formatDateTimeBR(new Date(), d.company.timezone);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = doc.page.height - 44;
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.5).strokeColor(BORDER).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(GRAY);
    const left = d.company.footerText ?? `${d.company.name} • ${isQuote ? 'Orçamento' : 'Pedido'} ${d.number}`;
    // margem inferior temporariamente zerada para não criar páginas extras ao escrever no rodapé
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.text(left, L, fy + 6, { width: W - 160, lineBreak: true, height: 20, ellipsis: true });
    doc.text(`Gerado em ${generated} • Página ${i - range.start + 1} de ${range.count}`, R - 200, fy + 6, { width: 200, align: 'right' });
    doc.page.margins.bottom = bottom;
  }
}

function infoBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  title: string,
  lines: [string, string | null | undefined][],
  measureOnly: boolean,
  fixedH?: number,
): number {
  const pad = 9;
  const labelW = 92;
  let h = 24;
  const visible = lines.filter(([, v]) => v && String(v).trim());
  doc.font('Helvetica').fontSize(8);
  for (const [, v] of visible) h += Math.max(doc.heightOfString(String(v), { width: w - pad * 2 - labelW }), 10) + 3;
  h += 6;
  if (measureOnly) return h;
  const H = fixedH ?? h;
  doc.roundedRect(x, y, w, H, 4).lineWidth(0.8).strokeColor(BORDER).stroke();
  doc.rect(x + pad, y + 15, 22, 1.6).fill(GOLD);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(NAVY).text(title, x + pad, y + 6, { width: w - pad * 2 });
  let cy = y + 24;
  for (const [label, v] of visible) {
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(label, x + pad, cy, { width: labelW });
    doc.font('Helvetica').fontSize(8).fillColor('#1F2937').text(String(v), x + pad + labelW, cy, { width: w - pad * 2 - labelW });
    cy = Math.max(doc.y, cy + 10) + 3;
  }
  return H;
}
