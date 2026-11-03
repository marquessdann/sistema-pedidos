import type { CompanySettings, Product, SalesRep } from '@prisma/client';
import { calculate, checkDiscountLimit, type CalcResult, type DiscountCheck, type PricingRule } from '@della/shared';
import type { Tx } from '../../db';
import { unprocessable } from '../../lib/errors';

export type SaleUnit = 'UN' | 'CX';

export interface LineInput {
  productId: string;
  quantity: number;
  discountBps?: number;
  /** UN = unidade do produto; CX = caixa (exige "unidades por caixa" no cadastro) */
  saleUnit?: SaleUnit;
}

export const lineKey = (productId: string, saleUnit: SaleUnit = 'UN') => `${productId}:${saleUnit}`;

export interface PriceOptions {
  items: LineInput[];
  generalDiscountBps: number;
  freightCents: number;
  rep: Pick<SalesRep, 'maxDiscountBps'>;
  settings: CompanySettings;
  /** Preços por unidade de venda a manter (ex.: preços aprovados no orçamento). Chave: lineKey(productId, saleUnit). */
  priceOverrides?: Map<string, number>;
  /** Permitir produtos inativos (somente para leitura/visualização). */
  allowInactive?: boolean;
}

type ProductWithBrand = Product & { brand: { name: string; active: boolean }; images: { fileName: string }[] };

export interface PricedLine {
  productId: string;
  position: number;
  sku: string;
  productName: string;
  brandName: string;
  unit: string;
  saleUnit: SaleUnit;
  unitsPerSaleUnit: number;
  imageFileName: string | null;
  quantity: number;
  unitPriceCents: number;
  discountBps: number;
  discountCents: number;
  grossCents: number;
  generalDiscountShareCents: number;
  netCents: number;
  surchargeCents: number;
  unitCostCents: number | null;
  taxRefBps: number | null;
}

export interface Priced {
  calc: CalcResult;
  check: DiscountCheck;
  lines: PricedLine[];
  products: Map<string, ProductWithBrand>;
}

/** Junta linhas repetidas do mesmo produto na mesma unidade de venda (somando as quantidades). */
export function mergeLines(items: LineInput[]): LineInput[] {
  const map = new Map<string, LineInput>();
  for (const it of items) {
    const k = lineKey(it.productId, it.saleUnit ?? 'UN');
    const cur = map.get(k);
    if (cur) cur.quantity += it.quantity;
    else map.set(k, { ...it, saleUnit: it.saleUnit ?? 'UN' });
  }
  return [...map.values()];
}

export async function loadRules(tx: Tx): Promise<PricingRule[]> {
  const rules = await tx.pricingRule.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    base: r.base,
    scope: r.scope,
    rateBps: r.rateBps,
    brandId: r.brandId,
    categoryId: r.categoryId,
    productId: r.productId,
  }));
}

/**
 * Calcula um pedido/orçamento EXCLUSIVAMENTE com dados do banco:
 * o navegador informa apenas produto, quantidade e percentuais de desconto.
 */
export async function priceItems(tx: Tx, opts: PriceOptions): Promise<Priced> {
  const items = mergeLines(opts.items);
  if (items.length === 0) throw unprocessable('Adicione pelo menos um produto.', 'NO_ITEMS');
  if (!opts.settings.allowItemDiscount && items.some((i) => (i.discountBps ?? 0) > 0)) {
    throw unprocessable('Desconto por item não está habilitado. Use o desconto geral.', 'ITEM_DISCOUNT_DISABLED');
  }
  if (!opts.settings.allowSellerFreight && opts.freightCents > 0) {
    throw unprocessable('O frete é definido pela empresa e não pode ser informado pelo vendedor.', 'FREIGHT_DISABLED');
  }

  const found = await tx.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
    include: {
      brand: { select: { name: true, active: true } },
      images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1, select: { fileName: true } },
    },
  });
  const products = new Map(found.map((p) => [p.id, p as ProductWithBrand]));
  const missing = items.filter((i) => !products.has(i.productId));
  if (missing.length) throw unprocessable('Um ou mais produtos não foram encontrados.', 'PRODUCT_NOT_FOUND');

  if (!opts.allowInactive) {
    const inactive = items
      .map((i) => products.get(i.productId)!)
      .filter((p) => !p.active || p.deletedAt || !p.brand.active);
    if (inactive.length) {
      throw unprocessable(
        `Produto(s) inativo(s) ou indisponível(is): ${inactive.map((p) => `${p.sku} – ${p.name}`).join(', ')}. Remova-os para continuar.`,
        'PRODUCT_INACTIVE',
        { productIds: inactive.map((p) => p.id) },
      );
    }
  }

  const factors = items.map((i) => {
    const p = products.get(i.productId)!;
    if (i.saleUnit !== 'CX') return 1;
    if (!p.unitsPerBox || p.unitsPerBox < 2) {
      throw unprocessable(`O produto ${p.sku} – ${p.name} não é vendido por caixa. Use a unidade (${p.unit}).`, 'NO_BOX_UNIT');
    }
    return p.unitsPerBox;
  });

  const rules = await loadRules(tx);
  const calc = calculate({
    items: items.map((i, idx) => {
      const p = products.get(i.productId)!;
      return {
        productId: p.id,
        quantity: i.quantity,
        discountBps: i.discountBps ?? 0,
        unitPriceCents: opts.priceOverrides?.get(lineKey(p.id, i.saleUnit)) ?? p.priceCents * factors[idx],
        brandId: p.brandId,
        categoryId: p.categoryId,
        unitCostCents: p.costCents * factors[idx],
        productTaxRefBps: p.taxRefBps,
      };
    }),
    generalDiscountBps: opts.generalDiscountBps,
    freightCents: opts.freightCents,
    rules,
  });
  const check = checkDiscountLimit(calc, opts.rep.maxDiscountBps);

  const lines: PricedLine[] = calc.lines.map((l, idx) => {
    const p = products.get(l.productId)!;
    return {
      productId: p.id,
      position: idx + 1,
      sku: p.sku,
      productName: p.name,
      brandName: p.brand.name,
      unit: items[idx].saleUnit === 'CX' ? 'CX' : p.unit,
      saleUnit: items[idx].saleUnit ?? 'UN',
      unitsPerSaleUnit: factors[idx],
      imageFileName: p.images[0]?.fileName ?? null,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountBps: l.itemDiscountBps,
      discountCents: l.itemDiscountCents,
      grossCents: l.grossCents,
      generalDiscountShareCents: l.generalDiscountShareCents,
      netCents: l.netCents,
      surchargeCents: l.surchargeCents,
      unitCostCents: p.costCents * factors[idx],
      taxRefBps: p.taxRefBps,
    };
  });
  return { calc, check, lines, products };
}

/** Campos de totais para gravar em orders/quotes. */
export function totalsData(calc: CalcResult) {
  return {
    grossCents: calc.grossCents,
    itemDiscountCents: calc.itemDiscountCents,
    generalDiscountBps: calc.generalDiscountBps,
    generalDiscountCents: calc.generalDiscountCents,
    effectiveDiscountBps: calc.effectiveDiscountBps,
    surchargeCents: calc.surchargeCents,
    freightCents: calc.freightCents,
    totalCents: calc.totalCents,
    totalQuantity: calc.totalQuantity,
    costCents: calc.internal.costCents,
    internalTaxCents: calc.internal.internalTaxCents,
    marginCents: calc.internal.marginCents,
    calcSnapshot: { steps: calc.steps, surcharges: calc.surcharges, internal: calc.internal } as object,
  };
}

export function maxItemDiscount(calc: CalcResult) {
  return calc.lines.reduce((m, l) => Math.max(m, l.itemDiscountBps), 0);
}

/** Uma aprovação cobre o cálculo se nenhum desconto ultrapassar o que foi aprovado. */
export function approvalCovers(
  approval: { requestedBps: number; generalDiscountBps: number; maxItemDiscountBps: number },
  calc: CalcResult,
) {
  return (
    calc.effectiveDiscountBps <= approval.requestedBps &&
    calc.generalDiscountBps <= approval.generalDiscountBps &&
    maxItemDiscount(calc) <= approval.maxItemDiscountBps
  );
}

/** Versão do cálculo segura para o vendedor/cliente (sem custo, margem e tributos internos). */
export function publicCalc(calc: CalcResult, includeInternal = false) {
  const { internal, lines, ...rest } = calc;
  return {
    ...rest,
    lines: lines.map(({ costCents, internalTaxCents, ...l }) => (includeInternal ? { ...l, costCents, internalTaxCents } : l)),
    ...(includeInternal ? { internal } : {}),
  };
}

/** Verifica a disponibilidade em estoque (quando o controle estiver habilitado), em unidades do produto. */
export function stockShortages(priced: Priced) {
  const needed = new Map<string, number>();
  for (const l of priced.lines) needed.set(l.productId, (needed.get(l.productId) ?? 0) + l.quantity * l.unitsPerSaleUnit);
  return [...needed.entries()]
    .map(([productId, requested]) => {
      const p = priced.products.get(productId)!;
      return { productId, sku: p.sku, name: p.name, requested, available: p.stockQty - p.reservedQty };
    })
    .filter((s) => s.available < s.requested);
}
