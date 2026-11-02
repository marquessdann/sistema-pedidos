/**
 * Motor de cálculo comercial da Della.
 *
 * Ordem de cálculo (cada etapa tem uma base bem definida, nada é aplicado duas vezes):
 *
 *  1. Bruto da linha            = preço unitário autorizado × quantidade
 *  2. Desconto do item          = bruto da linha × desconto do item (%)
 *  3. Líquido do item           = bruto da linha − desconto do item
 *  4. Subtotal após itens       = Σ líquido dos itens
 *  5. Desconto geral (vendedor) = subtotal após itens × desconto geral (%)
 *     (rateado entre as linhas proporcionalmente, pelo método do maior resto, para que a soma feche ao centavo)
 *  6. Líquido final da linha    = líquido do item − rateio do desconto geral
 *  7. Acréscimos configurados   = Σ por regra: base (BRUTO ou LÍQUIDO da linha) × alíquota da regra
 *     (apenas regras do tipo SURCHARGE, que são cobradas do cliente)
 *  8. Total                     = subtotal após itens − desconto geral + acréscimos + frete
 *
 * Tributos de referência internos (INTERNAL_ESTIMATE) são calculados à parte, apenas para estimar a margem;
 * eles NÃO entram no total cobrado do cliente e nunca são exibidos ao vendedor/cliente.
 */
import { BPS_100_PERCENT, assertInt, formatBRL, formatBps, mulBps, ratioBps } from './money';

export type RuleKind = 'SURCHARGE' | 'INTERNAL_ESTIMATE';
export type RuleBase = 'GROSS' | 'NET';
export type RuleScope = 'ALL' | 'BRAND' | 'CATEGORY' | 'PRODUCT';

export interface PricingRule {
  id: string;
  name: string;
  kind: RuleKind;
  base: RuleBase;
  scope: RuleScope;
  rateBps: number;
  brandId?: string | null;
  categoryId?: string | null;
  productId?: string | null;
}

export interface CalcItemInput {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  discountBps?: number;
  brandId?: string | null;
  categoryId?: string | null;
  /** Apenas no backend/admin. */
  unitCostCents?: number | null;
  /** Percentual tributário de referência do produto (interno). Apenas no backend/admin. */
  productTaxRefBps?: number | null;
}

export interface CalcInput {
  items: CalcItemInput[];
  generalDiscountBps?: number;
  freightCents?: number;
  rules?: PricingRule[];
}

export interface CalcLine {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  grossCents: number;
  itemDiscountBps: number;
  itemDiscountCents: number;
  netBeforeGeneralCents: number;
  generalDiscountShareCents: number;
  netCents: number;
  surchargeCents: number;
  internalTaxCents: number;
  costCents: number | null;
}

export interface RuleAmount {
  ruleId: string;
  name: string;
  rateBps: number;
  base: RuleBase;
  amountCents: number;
}

export interface CalcResult {
  lines: CalcLine[];
  totalQuantity: number;
  itemCount: number;
  grossCents: number;
  itemDiscountCents: number;
  subtotalAfterItemDiscountCents: number;
  generalDiscountBps: number;
  generalDiscountCents: number;
  totalDiscountCents: number;
  /** Desconto efetivo total (itens + geral) sobre o bruto, em bps. */
  effectiveDiscountBps: number;
  surcharges: RuleAmount[];
  surchargeCents: number;
  freightCents: number;
  totalCents: number;
  /** Informações internas: nunca enviar ao vendedor (salvo permissão) nem ao PDF do cliente. */
  internal: {
    taxes: RuleAmount[];
    productTaxRefCents: number;
    internalTaxCents: number;
    costCents: number | null;
    marginCents: number | null;
    marginBps: number | null;
  };
  /** Memória de cálculo legível (pt-BR) para o administrador entender cada valor. */
  steps: string[];
}

export class PricingError extends Error {}

function validateBps(bps: number, field: string) {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_100_PERCENT) {
    throw new PricingError(`${field} deve estar entre 0% e 100%.`);
  }
}

function ruleApplies(rule: PricingRule, item: CalcItemInput): boolean {
  switch (rule.scope) {
    case 'ALL':
      return true;
    case 'BRAND':
      return !!rule.brandId && rule.brandId === item.brandId;
    case 'CATEGORY':
      return !!rule.categoryId && rule.categoryId === item.categoryId;
    case 'PRODUCT':
      return !!rule.productId && rule.productId === item.productId;
    default:
      return false;
  }
}

/** Rateia `amount` proporcionalmente aos `weights` (maior resto), garantindo soma exata. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => {
    const num = BigInt(amount) * BigInt(w);
    const floor = num / BigInt(total);
    const rem = num % BigInt(total);
    return { floor: Number(floor), rem };
  });
  let allocated = raw.reduce((a, r) => a + r.floor, 0);
  const order = raw.map((r, i) => ({ i, rem: r.rem })).sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  const result = raw.map((r) => r.floor);
  let k = 0;
  while (allocated < amount && order.length > 0) {
    result[order[k % order.length].i] += 1;
    allocated += 1;
    k += 1;
  }
  return result;
}

export function calculate(input: CalcInput): CalcResult {
  const generalDiscountBps = input.generalDiscountBps ?? 0;
  const freightCents = input.freightCents ?? 0;
  const rules = input.rules ?? [];
  validateBps(generalDiscountBps, 'Desconto geral');
  assertInt(freightCents, 'frete');
  if (freightCents < 0) throw new PricingError('O frete não pode ser negativo.');

  const steps: string[] = [];

  const partial = input.items.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new PricingError('A quantidade de cada item deve ser um número inteiro maior que zero.');
    }
    if (item.quantity > 1_000_000) throw new PricingError('Quantidade acima do limite permitido.');
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new PricingError('Preço unitário inválido.');
    }
    const discountBps = item.discountBps ?? 0;
    validateBps(discountBps, 'Desconto do item');
    const grossCents = item.unitPriceCents * item.quantity;
    assertInt(grossCents, 'bruto da linha');
    const itemDiscountCents = mulBps(grossCents, discountBps);
    return { item, discountBps, grossCents, itemDiscountCents, net: grossCents - itemDiscountCents };
  });

  const grossCents = partial.reduce((a, p) => a + p.grossCents, 0);
  const itemDiscountCents = partial.reduce((a, p) => a + p.itemDiscountCents, 0);
  const subtotalAfterItemDiscountCents = grossCents - itemDiscountCents;
  const generalDiscountCents = mulBps(subtotalAfterItemDiscountCents, generalDiscountBps);
  const shares = allocate(
    generalDiscountCents,
    partial.map((p) => p.net),
  );

  steps.push(`Subtotal bruto (preço × quantidade): ${formatBRL(grossCents)}`);
  if (itemDiscountCents > 0) {
    steps.push(`Descontos por item: −${formatBRL(itemDiscountCents)} → ${formatBRL(subtotalAfterItemDiscountCents)}`);
  }
  if (generalDiscountBps > 0) {
    steps.push(
      `Desconto geral de ${formatBps(generalDiscountBps)} sobre ${formatBRL(subtotalAfterItemDiscountCents)}: −${formatBRL(generalDiscountCents)}`,
    );
  }

  const surchargeMap = new Map<string, RuleAmount>();
  const taxMap = new Map<string, RuleAmount>();
  let costKnown = true;
  let productTaxRefCents = 0;

  const lines: CalcLine[] = partial.map((p, idx) => {
    const netCents = p.net - shares[idx];
    let surchargeCents = 0;
    let internalTaxCents = 0;
    for (const rule of rules) {
      if (!ruleApplies(rule, p.item)) continue;
      validateBps(rule.rateBps, `Alíquota da regra ${rule.name}`);
      const base = rule.base === 'GROSS' ? p.grossCents : netCents;
      const amount = mulBps(base, rule.rateBps);
      const map = rule.kind === 'SURCHARGE' ? surchargeMap : taxMap;
      const current = map.get(rule.id) ?? { ruleId: rule.id, name: rule.name, rateBps: rule.rateBps, base: rule.base, amountCents: 0 };
      current.amountCents += amount;
      map.set(rule.id, current);
      if (rule.kind === 'SURCHARGE') surchargeCents += amount;
      else internalTaxCents += amount;
    }
    if (p.item.productTaxRefBps) {
      productTaxRefCents += mulBps(netCents, p.item.productTaxRefBps);
    }
    let costCents: number | null = null;
    if (p.item.unitCostCents === null || p.item.unitCostCents === undefined) costKnown = false;
    else costCents = p.item.unitCostCents * p.item.quantity;
    return {
      productId: p.item.productId,
      quantity: p.item.quantity,
      unitPriceCents: p.item.unitPriceCents,
      grossCents: p.grossCents,
      itemDiscountBps: p.discountBps,
      itemDiscountCents: p.itemDiscountCents,
      netBeforeGeneralCents: p.net,
      generalDiscountShareCents: shares[idx],
      netCents,
      surchargeCents,
      internalTaxCents,
      costCents,
    };
  });

  const surcharges = [...surchargeMap.values()];
  const taxes = [...taxMap.values()];
  const surchargeCents = surcharges.reduce((a, s) => a + s.amountCents, 0);
  for (const s of surcharges) {
    steps.push(
      `Acréscimo "${s.name}" (${formatBps(s.rateBps)} sobre o valor ${s.base === 'GROSS' ? 'bruto' : 'líquido'} dos itens aplicáveis): +${formatBRL(s.amountCents)}`,
    );
  }
  if (freightCents > 0) steps.push(`Frete: +${formatBRL(freightCents)}`);

  const totalCents = subtotalAfterItemDiscountCents - generalDiscountCents + surchargeCents + freightCents;
  steps.push(`Total do pedido: ${formatBRL(totalCents)}`);

  const totalDiscountCents = itemDiscountCents + generalDiscountCents;
  const netRevenue = subtotalAfterItemDiscountCents - generalDiscountCents;
  const internalTaxCents = taxes.reduce((a, t) => a + t.amountCents, 0) + productTaxRefCents;
  const costCents = costKnown && lines.length > 0 ? lines.reduce((a, l) => a + (l.costCents ?? 0), 0) : null;
  const marginCents = costCents === null ? null : netRevenue - costCents - internalTaxCents;
  const marginBps = marginCents === null || netRevenue <= 0 ? null : Math.round((marginCents * 10000) / netRevenue);

  return {
    lines,
    totalQuantity: lines.reduce((a, l) => a + l.quantity, 0),
    itemCount: lines.length,
    grossCents,
    itemDiscountCents,
    subtotalAfterItemDiscountCents,
    generalDiscountBps,
    generalDiscountCents,
    totalDiscountCents,
    effectiveDiscountBps: ratioBps(totalDiscountCents, grossCents),
    surcharges,
    surchargeCents,
    freightCents,
    totalCents,
    internal: { taxes, productTaxRefCents, internalTaxCents, costCents, marginCents, marginBps },
    steps,
  };
}

export interface DiscountCheck {
  withinLimit: boolean;
  maxDiscountBps: number;
  reasons: string[];
}

/**
 * Verifica o limite de desconto do vendedor.
 * Considera o desconto de cada item, o desconto geral e o desconto efetivo combinado
 * (para impedir que a soma de descontos ultrapasse o limite).
 */
export function checkDiscountLimit(result: CalcResult, maxDiscountBps: number): DiscountCheck {
  const reasons: string[] = [];
  for (const l of result.lines) {
    if (l.itemDiscountBps > maxDiscountBps) {
      reasons.push(`Desconto de item (${formatBps(l.itemDiscountBps)}) acima do limite de ${formatBps(maxDiscountBps)}.`);
      break;
    }
  }
  if (result.generalDiscountBps > maxDiscountBps) {
    reasons.push(`Desconto geral (${formatBps(result.generalDiscountBps)}) acima do limite de ${formatBps(maxDiscountBps)}.`);
  }
  // comparação exata em inteiros: desconto_total / bruto > limite
  if (BigInt(result.totalDiscountCents) * 10000n > BigInt(maxDiscountBps) * BigInt(result.grossCents)) {
    reasons.push(
      `Desconto total efetivo (${formatBps(result.effectiveDiscountBps)}) acima do limite de ${formatBps(maxDiscountBps)}.`,
    );
  }
  return { withinLimit: reasons.length === 0, maxDiscountBps, reasons };
}
