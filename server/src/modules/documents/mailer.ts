import nodemailer from 'nodemailer';
import { emailEnabled, env } from '../../config';
import { AppError } from '../../lib/errors';

let transport: nodemailer.Transporter | null = null;

/** Envio por e-mail via SMTP configurado por variáveis de ambiente. Sem SMTP_HOST, fica desabilitado. */
export async function sendMail(opts: { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] }) {
  if (!emailEnabled) {
    throw new AppError(503, 'Envio por e-mail não configurado. Defina SMTP_HOST e as demais variáveis SMTP no servidor.', 'EMAIL_NOT_CONFIGURED');
  }
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const info = await transport.sendMail({ from: env.SMTP_FROM ?? env.SMTP_USER, ...opts });
  return { messageId: info.messageId };
}
