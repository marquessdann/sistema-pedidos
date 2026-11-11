import PDFDocument from 'pdfkit';
import { formatBRL, formatBps, formatDateBR } from '@della/shared';
import { pdfSafeText } from '../documents/pdf';

const NAVY = '#0F2341';
const GOLD = '#C29B45';
const GRAY = '#5B6170';
const LINE = '#D9DEE7';
const ZEBRA = '#F6F8FB';

type ColType = 'text' | 'money' | 'int' | 'percent' | 'date';
export interface ReportPdfData {
  title: string;
  description?: string;
  columns: { key: string; label: string; type: ColType }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  period: string;
  filters: string[];
  generatedAt: string;
  companyName: string;
  logo: Buffer | null;
}

const t = (s: string | null | undefined) => pdfSafeText(s ?? '');
const numeric = (type: ColType) => type === 'money' || type === 'int' || type === 'percent';

function cell(v: unknown, type: ColType): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && type !== 'text' && type !== 'date' && !/^-?\d+$/.test(v)) return v; // ex.: "3 pedido(s)" no total
  if (type === 'money') return formatBRL(Number(v));
  if (type === 'percent') return formatBps(Number(v));
  if (type === 'date') return formatDateBR(String(v));
  if (type === 'int') return Number(v).toLocaleString('pt-BR');
  return String(v);
}

/** PDF de um relatório (mesma tabela da tela), em A4 paisagem, com cabeçalho Della e paginação. */
export function renderReportPdf(d: ReportPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 32, bottom: 40, left: 36, right: 36 }, bufferPages: true, info: { Title: d.title, Creator: 'Sistema de Pedidos Della' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      const L = 36;
      const R = doc.page.width - 36;
      const W = R - L;
      const bottom = doc.page.height - 48;
      let y = 28;

      if (d.logo) {
        try {
          doc.image(d.logo, L, y, { fit: [150, 40] });
        } catch {
          /* sem logotipo */
        }
      }
      doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(t(d.title), L + 170, y, { width: W - 170, align: 'right' });
      doc.font('Helvetica').fontSize(9.5).fillColor(GRAY).text(t(`Período: ${d.period}`), L + 170, doc.y + 2, { width: W - 170, align: 'right' });
      y = Math.max(doc.y, 72) + 6;
      doc.rect(L, y, W, 2.5).fill(GOLD);
      y += 9;
      const meta = [...d.filters, d.description ?? ''].filter(Boolean).join('  •  ');
      if (meta) {
        doc.font('Helvetica').fontSize(8).fillColor(GRAY).text(t(meta), L, y, { width: W });
        y = doc.y + 8;
      }

      // larguras: proporcionais ao conteúdo, com limites
      doc.font('Helvetica').fontSize(8);
      const sample = [...d.rows.slice(0, 200), ...(d.totals ? [d.totals] : [])];
      const want = d.columns.map((c) => {
        const head = doc.font('Helvetica-Bold').widthOfString(t(c.label.toUpperCase()));
        doc.font('Helvetica');
        const body = Math.max(0, ...sample.map((r) => doc.widthOfString(t(cell(r[c.key], c.type)))));
        return Math.min(Math.max(head, body) + 14, c.type === 'text' ? 260 : 110);
      });
      const sum = want.reduce((a, b) => a + b, 0);
      const widths = want.map((w) => (w * W) / sum);
      const xs = widths.map((_, i) => L + widths.slice(0, i).reduce((a, b) => a + b, 0));

      const header = () => {
        const h = 22;
        doc.rect(L, y, W, h).fill(NAVY);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff');
        d.columns.forEach((c, i) => doc.text(t(c.label.toUpperCase()), xs[i] + 5, y + 7.5, { width: widths[i] - 10, align: numeric(c.type) ? 'right' : 'left', lineBreak: false, ellipsis: true }));
        y += h;
      };
      const row = (r: Record<string, unknown>, opts: { bold?: boolean; fill?: string }) => {
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const texts = d.columns.map((c) => t(r[c.key] === undefined && opts.bold ? '' : cell(r[c.key], c.type)));
        const h = Math.max(18, ...texts.map((s, i) => doc.heightOfString(s, { width: widths[i] - 10 }) + 9));
        if (y + h > bottom) {
          doc.addPage();
          y = 32;
          header();
          doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        }
        if (opts.fill) doc.rect(L, y, W, h).fill(opts.fill);
        doc.fillColor(opts.bold ? NAVY : '#222');
        texts.forEach((s, i) => doc.text(s, xs[i] + 5, y + 5, { width: widths[i] - 10, align: numeric(d.columns[i].type) ? 'right' : 'left' }));
        doc.moveTo(L, y + h).lineTo(R, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
        y += h;
      };

      header();
      if (!d.rows.length) {
        doc.font('Helvetica').fontSize(9).fillColor(GRAY).text('Sem dados para os filtros selecionados.', L, y + 14, { width: W, align: 'center' });
      }
      d.rows.forEach((r, i) => row(r, { fill: i % 2 ? ZEBRA : undefined }));
      if (d.totals && d.rows.length) row(d.totals, { bold: true, fill: '#E8ECF4' });

      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0;
        const fy = doc.page.height - 30;
        doc.font('Helvetica').fontSize(7.5).fillColor(GRAY);
        doc.text(t(`${d.companyName} • Gerado em ${d.generatedAt}`), L, fy, { width: W / 2, lineBreak: false });
        doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, fy, { width: W / 2, align: 'right', lineBreak: false });
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
