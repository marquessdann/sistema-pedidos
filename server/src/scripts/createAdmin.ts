/**
 * Cria (ou redefine a senha de) um administrador de forma segura pela linha de comando.
 * Uso: ADMIN_USERNAME=fulano ADMIN_PASSWORD='SenhaForte123' ADMIN_NAME='Fulano' npm run create-admin
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password';

const prisma = new PrismaClient();

async function main() {
  const username = (process.env.ADMIN_USERNAME ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const name = process.env.ADMIN_NAME ?? 'Administrador';
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('ADMIN_USERNAME inválido.');
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('ADMIN_PASSWORD deve ter pelo menos 10 caracteres, com letras e números.');
  }
  const passwordHash = await hashPassword(password);
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing && existing.role !== 'ADMIN') throw new Error('Já existe um usuário não-administrador com esse nome.');
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, active: true, lockedUntil: null, failedLoginCount: 0 } });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    console.log(`✔ Senha do administrador "${username}" redefinida.`);
  } else {
    await prisma.user.create({ data: { username, name, role: 'ADMIN', passwordHash } });
    console.log(`✔ Administrador "${username}" criado.`);
  }
  await prisma.auditLog.create({ data: { action: existing ? 'ADMIN_PASSWORD_RESET_CLI' : 'ADMIN_CREATED_CLI', entity: 'user', entityId: username } });
}

main()
  .catch((e) => {
    console.error('✖', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
