import PDFDocument from 'pdfkit';
import { formatDateBR, formatPhone } from '@della/shared';
import { pdfSafeText } from '../documents/pdf';

const NAVY = '#0F2341';
const GOLD = '#C29B45';
const GRAY = '#5B6170';
const LINE = '#D9DEE7';

export interface PickingData {
  number: string;
  statusLabel: string;
  orderDate: string;
  expectedDelivery: string | null;
  sellerName: string;
  client: { name: string; tradeName: string | null; phone: string | null; responsible: string | null; address: string };
  notes: string | null;
  items: { sku: string; name: string; brand: string; quantity: number; saleUnit: string; unitsPerSaleUnit: number; unit: string }[];
  logo: Buffer | null;
}

const t = (s: string | null | undefined) => pdfSafeText(s ?? '');

/** PDF de separação (romaneio) para a logística: sem preços, com quadradinho para marcar cada item. */
export function renderPickingPdf(d: PickingData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 50, left: 40, right: 40 }, bufferPages: true, info: { Title: `Separação ${d.number}`, Creator: 'Sistema de Pedidos Della' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      const L = 40;
      const R = doc.page.width - 40;
      const W = R - L;
      let y = 32;
      if (d.logo) {
        try {
          doc.image(d.logo, L, y, { fit: [170, 44] });
        } catch {
          /* sem logotipo */
        }
      }
      doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('SEPARAÇÃO DE PEDIDO', L + 200, y + 2, { width: W - 200, align: 'right' });
      doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(`Pedido ${t(d.number)} • ${t(d.statusLabel)}`, L + 200, y + 26, { width: W - 200, align: 'right' });
      y = 86;
      doc.rect(L, y, W, 2.5).fill(GOLD);
      y += 12;

      // cliente e entrega
      const boxH = 96;
      doc.roundedRect(L, y, W, boxH, 6).lineWidth(0.8).strokeColor(LINE).stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('CLIENTE', L + 12, y + 10);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(t(d.client.tradeName || d.client.name), L + 12, y + 22, { width: W * 0.6 });
      doc.font('Helvetica').fontSize(9).fillColor('#222').text(t(d.client.name), L + 12, doc.y + 1, { width: W * 0.6 });
      doc.text(t(d.client.address) || 'Endereço não informado', L + 12, doc.y + 3, { width: W * 0.6 });
      const contact = [d.client.responsible, d.client.phone ? formatPhone(d.client.phone) : null].filter(Boolean).join(' • ');
      if (contact) doc.text(t(contact), L + 12, doc.y + 3, { width: W * 0.6 });
      const cx = L + W * 0.66;
      const info: [string, string][] = [
        ['Data do pedido', formatDateBR(d.orderDate)],
        ['Previsão de entrega', d.expectedDelivery ? formatDateBR(d.expectedDelivery) : '—'],
        ['Vendedor', d.sellerName],
      ];
      let iy = y + 10;
      for (const [k, v] of info) {
        const urgent = k === 'Previsão de entrega' && !!d.expectedDelivery;
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(urgent ? '#C62828' : GRAY).text(urgent ? 'ENTREGAR ATÉ' : k.toUpperCase(), cx, iy);
        doc.font(urgent ? 'Helvetica-Bold' : 'Helvetica').fontSize(urgent ? 13 : 10).fillColor(urgent ? '#C62828' : '#222').text(t(v), cx, iy + 10, { width: R - cx - 10 });
        iy += 27;
      }
      y += boxH + 14;

      // tabela de itens
      const cols = { chk: L, sku: L + 26, prod: L + 118, qty: R - 120, unit: R - 60 };
      const header = () => {
        doc.rect(L, y, W, 20).fill(NAVY);
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff');
        doc.text('OK', cols.chk + 6, y + 6);
        doc.text('SKU', cols.sku, y + 6);
        doc.text('PRODUTO', cols.prod, y + 6);
        doc.text('QTD', cols.qty, y + 6, { width: 50, align: 'right' });
        doc.text('UNIDADE', cols.unit, y + 6, { width: 60, align: 'right' });
        y += 20;
      };
      header();
      let totalUn = 0;
      d.items.forEach((it, i) => {
        const prodText = `${t(it.name)}\n${t(it.brand)}`;
        doc.font('Helvetica').fontSize(9);
        const h = Math.max(30, doc.heightOfString(prodText, { width: cols.qty - cols.prod - 10 }) + 12);
        if (y + h > doc.page.height - 120) {
          doc.addPage();
          y = 40;
          header();
        }
        if (i % 2 === 1) doc.rect(L, y, W, h).fill('#F5F7FA');
        doc.rect(cols.chk + 5, y + h / 2 - 7, 14, 14).lineWidth(1).strokeColor(NAVY).stroke();
        doc.font('Helvetica').fontSize(8).fillColor('#333').text(t(it.sku), cols.sku, y + 7, { width: cols.prod - cols.sku - 6 });
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(t(it.name), cols.prod, y + 6, { width: cols.qty - cols.prod - 10 });
        doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(t(it.brand), cols.prod, doc.y + 1, { width: cols.qty - cols.prod - 10 });
        doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY).text(String(it.quantity), cols.qty, y + h / 2 - 7, { width: 50, align: 'right' });
        const un = it.saleUnit === 'CX' ? `CX (${it.unitsPerSaleUnit} un)` : it.unit;
        doc.font('Helvetica').fontSize(9).fillColor('#333').text(t(un), cols.unit, y + h / 2 - 5, { width: 60, align: 'right' });
        totalUn += it.quantity * (it.unitsPerSaleUnit || 1);
        y += h;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke();
      });
      y += 8;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(`${d.items.length} produto(s) • ${totalUn} unidade(s) no total`, L, y, { width: W, align: 'right' });
      y = doc.y + 14;

      if (d.notes) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAY).text('OBSERVAÇÕES DO PEDIDO', L, y);
        doc.font('Helvetica').fontSize(10).fillColor('#222').text(t(d.notes), L, doc.y + 3, { width: W });
        y = doc.y + 14;
      }

      // assinaturas
      if (y > doc.page.height - 140) {
        doc.addPage();
        y = 60;
      }
      y = Math.max(y + 20, doc.page.height - 140);
      const sw = (W - 30) / 2;
      for (const [i, label] of ['Separado por', 'Conferido / entregue por'].entries()) {
        const x = L + i * (sw + 30);
        doc.moveTo(x, y + 30).lineTo(x + sw, y + 30).lineWidth(0.8).strokeColor('#888').stroke();
        doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(`${label} • Data: ____/____/______`, x, y + 35, { width: sw });
      }

      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(pages.start + i);
        doc.font('Helvetica').fontSize(7.5).fillColor(GRAY).text(`Della • Separação do pedido ${t(d.number)} • Documento interno, sem valores • Página ${i + 1} de ${pages.count}`, L, doc.page.height - 34, { width: W, align: 'center', lineBreak: false });
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
