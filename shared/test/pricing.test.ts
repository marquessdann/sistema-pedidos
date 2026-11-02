import { describe, expect, it } from 'vitest';
import { allocate, calculate, checkDiscountLimit, PricingError } from '../src/pricing';
import { formatBRL, mulBps, parseBRLToCents, parsePercentToBps } from '../src/money';

describe('motor de cálculo', () => {
  it('calcula subtotal de vários produtos', () => {
    const r = calculate({
      items: [
        { productId: 'a', quantity: 2, unitPriceCents: 25_000 },
        { productId: 'b', quantity: 5, unitPriceCents: 10_000 },
      ],
    });
    expect(r.grossCents).toBe(100_000);
    expect(r.totalQuantity).toBe(7);
    expect(r.itemCount).toBe(2);
    expect(r.totalCents).toBe(100_000);
  });

  it('aplica desconto percentual do vendedor (exemplo do enunciado)', () => {
    const r = calculate({ items: [{ productId: 'a', quantity: 1, unitPriceCents: 100_000 }], generalDiscountBps: 500 });
    expect(r.generalDiscountCents).toBe(5_000);
    expect(r.totalCents).toBe(95_000);
    expect(r.effectiveDiscountBps).toBe(500);
  });

  it('aplica desconto por item antes do desconto geral, sem aplicar duas vezes', () => {
    const r = calculate({
      items: [{ productId: 'a', quantity: 1, unitPriceCents: 100_000, discountBps: 1000 }],
      generalDiscountBps: 1000,
    });
    expect(r.itemDiscountCents).toBe(10_000);
    expect(r.generalDiscountCents).toBe(9_000);
    expect(r.totalCents).toBe(81_000);
    expect(r.totalDiscountCents).toBe(19_000);
  });

  it('rateia o desconto geral fechando ao centavo', () => {
    const r = calculate({
      items: [
        { productId: 'a', quantity: 1, unitPriceCents: 333 },
        { productId: 'b', quantity: 1, unitPriceCents: 333 },
        { productId: 'c', quantity: 1, unitPriceCents: 334 },
      ],
      generalDiscountBps: 1000,
    });
    const shares = r.lines.reduce((a, l) => a + l.generalDiscountShareCents, 0);
    expect(shares).toBe(r.generalDiscountCents);
    expect(r.lines.reduce((a, l) => a + l.netCents, 0)).toBe(r.totalCents);
  });

  it('acréscimos usam a base configurada e o frete é somado ao final', () => {
    const r = calculate({
      items: [
        { productId: 'a', quantity: 1, unitPriceCents: 100_000, categoryId: 'c1' },
        { productId: 'b', quantity: 1, unitPriceCents: 100_000, categoryId: 'c2' },
      ],
      generalDiscountBps: 1000,
      freightCents: 1_500,
      rules: [
        { id: 'r1', name: 'ST', kind: 'SURCHARGE', base: 'NET', scope: 'CATEGORY', categoryId: 'c1', rateBps: 500 },
        { id: 'r2', name: 'IPI', kind: 'SURCHARGE', base: 'GROSS', scope: 'ALL', rateBps: 100 },
        { id: 'r3', name: 'Interno', kind: 'INTERNAL_ESTIMATE', base: 'NET', scope: 'ALL', rateBps: 900 },
      ],
    });
    // desconto geral 10% de 2000,00 = 200,00; líquido por linha = 900,00
    expect(r.generalDiscountCents).toBe(20_000);
    // ST: 5% de 900,00 (só c1) = 45,00 ; IPI: 1% de 2000,00 bruto = 20,00
    expect(r.surchargeCents).toBe(4_500 + 2_000);
    expect(r.totalCents).toBe(200_000 - 20_000 + 6_500 + 1_500);
    // tributo interno não entra no total
    expect(r.internal.internalTaxCents).toBe(16_200);
  });

  it('calcula margem estimada quando o custo é conhecido', () => {
    const r = calculate({ items: [{ productId: 'a', quantity: 2, unitPriceCents: 10_000, unitCostCents: 6_000 }] });
    expect(r.internal.costCents).toBe(12_000);
    expect(r.internal.marginCents).toBe(8_000);
    expect(r.internal.marginBps).toBe(4000);
  });

  it('rejeita quantidade inválida e descontos fora da faixa', () => {
    expect(() => calculate({ items: [{ productId: 'a', quantity: 0, unitPriceCents: 1 }] })).toThrow(PricingError);
    expect(() => calculate({ items: [{ productId: 'a', quantity: 1.5, unitPriceCents: 1 }] })).toThrow(PricingError);
    expect(() => calculate({ items: [{ productId: 'a', quantity: 1, unitPriceCents: 1 }], generalDiscountBps: -1 })).toThrow(PricingError);
    expect(() => calculate({ items: [{ productId: 'a', quantity: 1, unitPriceCents: 1 }], generalDiscountBps: 10001 })).toThrow(PricingError);
    expect(() => calculate({ items: [{ productId: 'a', quantity: 1, unitPriceCents: 1, discountBps: 20000 }] })).toThrow(PricingError);
  });

  it('desconto de 100% resulta em total zero (nunca negativo)', () => {
    const r = calculate({ items: [{ productId: 'a', quantity: 3, unitPriceCents: 999 }], generalDiscountBps: 10000 });
    expect(r.totalCents).toBe(0);
  });

  it('verifica limite de desconto do vendedor, inclusive combinado', () => {
    const items = [{ productId: 'a', quantity: 1, unitPriceCents: 100_000, discountBps: 500 }];
    expect(checkDiscountLimit(calculate({ items, generalDiscountBps: 0 }), 500).withinLimit).toBe(true);
    expect(checkDiscountLimit(calculate({ items, generalDiscountBps: 100 }), 500).withinLimit).toBe(false);
    expect(checkDiscountLimit(calculate({ items: [{ productId: 'a', quantity: 1, unitPriceCents: 100 }], generalDiscountBps: 600 }), 500).withinLimit).toBe(false);
  });
});

describe('dinheiro', () => {
  it('mulBps arredonda half-up e suporta valores grandes', () => {
    expect(mulBps(105, 5000)).toBe(53);
    expect(mulBps(1, 4999)).toBe(0);
    expect(mulBps(900_000_000_000, 9999)).toBe(899_910_000_000);
  });
  it('allocate fecha a soma', () => {
    expect(allocate(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
  });
  it('formata e interpreta valores', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(parseBRLToCents('1.234,56')).toBe(123456);
    expect(parseBRLToCents('R$ 10')).toBe(1000);
    expect(parseBRLToCents('10.5')).toBe(1050);
    expect(parseBRLToCents('1.000')).toBe(100000);
    expect(parseBRLToCents('abc')).toBeNull();
    expect(parsePercentToBps('5,5')).toBe(550);
    expect(parsePercentToBps('12%')).toBe(1200);
  });
});
