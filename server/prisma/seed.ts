/**
 * Seed de implantação (idempotente). Cria:
 *  - configurações padrão da empresa e transições de status;
 *  - condições de pagamento iniciais (editáveis);
 *  - primeiro administrador a partir das variáveis ADMIN_USERNAME / ADMIN_PASSWORD;
 *  - representante Victor Badur (usuário "victor").
 *
 * Senha do Victor: definida por SEED_VICTOR_PASSWORD (nunca gravada no código).
 * Sem a variável, em desenvolvimento usa "1234" com TROCA OBRIGATÓRIA no primeiro acesso;
 * em produção a variável é obrigatória (mínimo 10 caracteres com letras e números).
 * Comissão inicial 10% e desconto máximo 5% (editáveis em Vendedores).
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ORDER_TRANSITIONS } from '@della/shared';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();
const isProd = process.env.NODE_ENV === 'production';

function strong(p: string) {
  return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

async function main() {
  await prisma.companySettings.upsert({ where: { id: 1 }, create: { id: 1, companyName: 'Della' }, update: {} });

  if ((await prisma.orderStatusTransition.count()) === 0) {
    await prisma.orderStatusTransition.createMany({ data: DEFAULT_ORDER_TRANSITIONS.map(([fromStatus, toStatus]) => ({ fromStatus, toStatus })) });
    console.log('✔ Transições de status padrão criadas');
  }

  if ((await prisma.paymentTerm.count()) === 0) {
    await prisma.paymentTerm.createMany({
      data: [
        { name: 'À vista', days: null, sortOrder: 1 },
        { name: '28 dias', days: '28', sortOrder: 2 },
        { name: '30/60 dias', days: '30/60', sortOrder: 3 },
        { name: '30/60/90 dias', days: '30/60/90', sortOrder: 4 },
      ],
    });
    console.log('✔ Condições de pagamento iniciais criadas (edite em Configurações)');
  }

  // ---------- Administrador ----------
  const adminUser = (process.env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD ?? '';
  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUser } });
  if (existingAdmin) {
    console.log(`• Administrador "${adminUser}" já existe (senha não alterada)`);
  } else if (!adminPass) {
    console.warn('⚠ ADMIN_PASSWORD não definida: administrador NÃO criado. Defina no .env ou use "npm run create-admin".');
  } else if (!strong(adminPass)) {
    console.warn('⚠ ADMIN_PASSWORD fraca (mínimo 10 caracteres com letras e números): administrador NÃO criado.');
  } else {
    await prisma.user.create({
      data: { username: adminUser, name: process.env.ADMIN_NAME ?? 'Administrador', role: 'ADMIN', passwordHash: await hashPassword(adminPass) },
    });
    console.log(`✔ Administrador "${adminUser}" criado`);
  }

  // ---------- Representante Victor Badur ----------
  const victor = await prisma.user.findUnique({ where: { username: 'victor' } });
  if (victor) {
    console.log('• Usuário "victor" já existe (senha não alterada)');
  } else {
    const envPass = process.env.SEED_VICTOR_PASSWORD ?? '';
    let password: string | null = null;
    if (envPass) {
      if (isProd && !strong(envPass)) console.warn('⚠ SEED_VICTOR_PASSWORD fraca para produção: usuário "victor" NÃO criado.');
      else password = envPass;
    } else if (isProd) {
      console.warn('⚠ Produção: defina SEED_VICTOR_PASSWORD (senha forte) para criar o usuário "victor". A senha 1234 não é permitida em produção.');
    } else {
      password = '1234'; // somente desenvolvimento / implantação controlada, com troca obrigatória
    }
    if (password) {
      await prisma.user.create({
        data: {
          username: 'victor',
          name: 'Victor Badur',
          role: 'SELLER',
          passwordHash: await hashPassword(password),
          // senha escolhida pelo administrador via variável de ambiente: não exige troca; senha padrão de dev exige
          mustChangePassword: !envPass,
          salesRep: {
            create: {
              fullName: 'Victor Badur',
              title: 'Representante comercial',
              maxDiscountBps: 500,
              commissionBps: 1000,
              notes: 'Cadastro inicial. Completar CPF, telefones e comissão no painel administrativo.',
            },
          },
        },
      });
      console.log(`✔ Representante "Victor Badur" criado (usuário: victor${envPass ? '' : ' / senha inicial: 1234 com troca obrigatória'}; comissão 10%; desconto máximo 5%)`);
    }
  }
}

async function seedManager() {
  // ---------- Gestor Vinicius (acesso restrito ao que o Victor vende) ----------
  const username = (process.env.MANAGER_USERNAME ?? 'vinicius').trim().toLowerCase();
  const password = process.env.VINICIUS_PASSWORD ?? process.env.MANAGER_PASSWORD ?? '';
  if (await prisma.user.findUnique({ where: { username } })) {
    console.log(`• Gestor "${username}" já existe (senha não alterada)`);
    return;
  }
  if (!password) {
    console.log(`• VINICIUS_PASSWORD não definida: gestor "${username}" não criado.`);
    return;
  }
  if (password.length < 6) {
    console.warn('⚠ VINICIUS_PASSWORD precisa ter pelo menos 6 caracteres: gestor NÃO criado.');
    return;
  }
  if (!strong(password)) console.warn('⚠ Senha do gestor é fraca (recomendado: 10+ caracteres com letras e números). Criado mesmo assim, conforme solicitado.');
  const victor = await prisma.salesRep.findFirst({ where: { user: { username: 'victor' } } });
  await prisma.user.create({
    data: {
      username,
      name: process.env.MANAGER_NAME ?? 'Vinicius',
      role: 'MANAGER',
      passwordHash: await hashPassword(password),
      managerProfile: {
        create: {
          canViewSales: true,
          canViewCommissions: true,
          canReleaseProducts: true,
          canReleaseClients: true,
          canApproveDiscounts: false,
          canUpdateOrderStatus: false,
          reps: victor ? { create: [{ salesRepId: victor.id }] } : undefined,
        },
      },
    },
  });
  console.log(`✔ Gestor "${username}" criado (vê vendas e comissões${victor ? ' do Victor' : ''}, libera produtos e clientes)`);
}

main()
  .then(seedManager)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
