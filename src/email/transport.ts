import nodemailer from 'nodemailer';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from '../config.js';
import type { Email } from '../types.js';
import { JobError } from '../errors.js';
export class MailError extends JobError {
  constructor(public outcome: 'rejected' | 'unknown') { super('SMTP_FAILED', outcome === 'unknown' ? 'SMTP acceptance is uncertain; check provider logs before resending.' : 'SMTP rejected the email; check provider configuration and recipient.', 'email'); }
}
export function classifyMailError(error: unknown): { outcome: 'rejected' | 'unknown'; retry: boolean } {
  const e = error as { responseCode?: number; code?: string; command?: string };
  // An explicit SMTP response is a definite rejection; a lost DATA reply is ambiguous.
  if (e.responseCode && e.responseCode >= 400) return { outcome: 'rejected', retry: e.responseCode < 500 };
  const beforeData = ['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'AUTH PLAIN', 'AUTH LOGIN', 'MAIL FROM', 'RCPT TO'].includes(e.command || '');
  if (beforeData || ['EAUTH', 'EDNS', 'EENVELOPE'].includes(e.code || '')) return { outcome: 'rejected', retry: beforeData && e.code !== 'EAUTH' };
  return { outcome: 'unknown', retry: false };
}
export interface Mailer { send(email: Email, to: string, messageId: string, signal: AbortSignal): Promise<void>; close(): void }
export function createMailer(config: Config): Mailer {
  const transport = nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure,
    requireTLS: !config.smtpSecure, auth: { user: config.smtpUser, pass: config.smtpPass },
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000,
    disableFileAccess: true, disableUrlAccess: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true } });
  return {
    async send(email, to, messageId, signal) {
      for (let attempt = 0; attempt < 3; attempt++) {
        signal.throwIfAborted();
        const close = () => transport.close(); signal.addEventListener('abort', close, { once: true });
        try {
          const info = await transport.sendMail({ from: config.sender, to, messageId, ...email });
          if (!info.accepted.map(String).includes(to)) throw new MailError('rejected');
          return;
        } catch (error) {
          const classification = error instanceof MailError ? { outcome: error.outcome, retry: false } : classifyMailError(error);
          if (!classification.retry || attempt === 2 || signal.aborted) throw new MailError(classification.outcome);
        } finally { signal.removeEventListener('abort', close); }
        await delay(1000 * 2 ** attempt, undefined, { signal });
      }
    },
    close() { transport.close(); },
  };
}
