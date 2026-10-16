import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { safeError } from '../errors.js';
import { createMailer, type Mailer } from './transport.js';
import type { Config } from '../config.js';
// Report invalid job configuration using only independently validated mail settings.
// If mail settings themselves are invalid, logging remains the only safe fallback.
export async function reportConfigError(env: NodeJS.ProcessEnv, args: string[], error: unknown,
  factory: (config: Config) => Mailer = createMailer): Promise<'skipped' | 'accepted' | 'failed'> {
  if (args.includes('--dry-run') || args.includes('--fixtures') || !(args.includes('--send') || env.DRY_RUN === 'false')) return 'skipped';
  let mailer: Mailer | undefined;
  try {
    const mailEnv: NodeJS.ProcessEnv = {};
    for (const key of ['EMAIL_FROM', 'EMAIL_TO', 'ERROR_EMAIL_TO', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS']) mailEnv[key] = env[key];
    const config = loadConfig(mailEnv, ['--send']);
    const details = safeError(error); mailer = factory(config);
    await mailer.send({ subject: `[Sports Tracker] Failed — ${config.date}`, text: `The daily job could not start because its configuration is invalid.\nCategory: ${details.code}\n${details.message}\nCheck the private environment file and command-line options. No digest was sent.` }, config.errorRecipient, `<${randomUUID()}@${config.sender.split('@')[1]}>`, AbortSignal.timeout(25_000));
    return 'accepted';
  } catch { return 'failed'; }
  finally { mailer?.close(); }
}
