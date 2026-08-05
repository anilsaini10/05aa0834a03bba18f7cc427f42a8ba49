import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';

let transporter: Transporter | null = null;

export const initMailer = (): void => {
  if (transporter) return;

  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    console.warn('⚠️  GMAIL_USER/GMAIL_APP_PASSWORD not set — email sending disabled');
    return;
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });

  console.log('✅ Mailer initialized');
};

export const isMailerReady = (): boolean => transporter !== null;

export const sendMail = async (
  to:      string,
  subject: string,
  html:    string,
): Promise<void> => {
  if (!transporter) {
    const err = new Error('Email service is not configured') as any;
    err.code       = 'MAILER_NOT_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }

  await transporter.sendMail({
    from: `"Arise" <${env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
};
