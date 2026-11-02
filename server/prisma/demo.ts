/**
 * DADOS DE DEMONSTRAÇÃO — TOTALMENTE FICTÍCIOS.
 * Marcas, produtos e clientes recebem o prefixo "DEMO" para nunca serem confundidos com dados reais.
 * Não execute em produção. Para remover, apague os registros com prefixo DEMO ou recrie o banco.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// CNPJs fictícios com dígitos verificadores válidos (base 99.xxx.xxx/0001)
function cnpjFrom(base12: string) {
  const calc = (b: string) => {
    const w = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = b.split('').reduce((a, c, i) => a + Number(c) * w[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const d1 = calc(base12);
  return base12 + d1 + calc(base12 + d1);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Dados de demonstração não podem ser carregados em produção.');
  const victor = await prisma.salesRep.findFirst({ where: { user: { username: 'victor' } } });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  const catalog: Record<string, { cat: string; items: [string, string, number, number][] }> = {
    'DEMO Aurora Cosméticos': {
      cat: 'DEMO Cuidados com o cabelo',
      items: [
        ['AUR-001', 'Shampoo Hidratação Intensa 300 ml', 1890, 3290],
        ['AUR-002', 'Condicionador Hidratação Intensa 300 ml', 1950, 3390],
        ['AUR-003', 'Máscara Reconstrutora 500 g', 3400, 5990],
        ['AUR-004', 'Óleo Reparador de Pontas 60 ml', 2100, 3890],
      ],
    },
    'DEMO Brisa Natural': {
      cat: 'DEMO Cuidados com a pele',
      items: [
        ['BRI-010', 'Hidratante Corporal Aloe 400 ml', 1600, 2890],
        ['BRI-011', 'Sabonete Líquido Erva-Doce 250 ml', 900, 1690],
        ['BRI-012', 'Protetor Solar FPS 50 120 ml', 3800, 6490],
      ],
    },
    'DEMO Celeste Home': {
      cat: 'DEMO Casa e aromas',
      items: [
        ['CEL-100', 'Difusor de Ambiente Lavanda 250 ml', 2700, 4990],
        ['CEL-101', 'Vela Aromática Baunilha 180 g', 1800, 3490],
        ['CEL-102', 'Água Perfumada para Tecidos 500 ml', 1500, 2790],
      ],
    },
  };
  let i = 0;
  for (const [brandName, def] of Object.entries(catalog)) {
    const brand = await prisma.brand.upsert({ where: { name: brandName }, create: { name: brandName, sortOrder: i++ }, update: {} });
    const cat = await prisma.category.upsert({ where: { name: def.cat }, create: { name: def.cat }, update: {} });
    for (const [sku, name, cost, price] of def.items) {
      await prisma.product.upsert({
        where: { sku: `DEMO-${sku}` },
        create: {
          sku: `DEMO-${sku}`,
          name: `${name} (fictício)`,
          brandId: brand.id,
          categoryId: cat.id,
          unit: 'UN',
          costCents: cost,
          priceCents: price,
          taxRefBps: 0,
          stockQty: 100,
          description: 'Produto fictício para demonstração.',
          createdById: admin?.id,
        },
        update: {},
      });
    }
  }

  const clients = [
    ['991000000001', 'DEMO Comércio de Cosméticos Fictício Ltda', 'DEMO Beleza Pura', 'Ana Exemplo', 'São Paulo', 'SP'],
    ['991000000002', 'DEMO Distribuidora Imaginária S.A.', 'DEMO Distribuidora Sol', 'Bruno Teste', 'Campinas', 'SP'],
    ['991000000003', 'DEMO Farmácia Modelo Ltda', 'DEMO Farma Modelo', 'Carla Fictícia', 'Belo Horizonte', 'MG'],
  ];
  for (const [base, legal, trade, resp, city, uf] of clients) {
    const cnpj = cnpjFrom(base);
    await prisma.client.upsert({
      where: { cnpj },
      create: {
        cnpj,
        legalName: legal,
        tradeName: trade,
        responsibleName: resp,
        commercialEmail: 'contato@exemplo.invalid',
        financeEmail: 'financeiro@exemplo.invalid',
        commercialPhone: '11900000000',
        city,
        state: uf,
        status: 'ACTIVE',
        salesRepId: victor?.id,
        notes: 'Cliente fictício para demonstração.',
        createdById: admin?.id,
        updatedById: admin?.id,
      },
      update: {},
    });
  }
  // um cliente aguardando liberação
  const pend = cnpjFrom('991000000004');
  await prisma.client.upsert({
    where: { cnpj: pend },
    create: { cnpj: pend, legalName: 'DEMO Mercado Aguardando Liberação Ltda', status: 'UNDER_REVIEW', salesRepId: victor?.id, createdById: admin?.id },
    update: {},
  });
  console.log('✔ Dados de demonstração (fictícios, prefixo DEMO) carregados.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
