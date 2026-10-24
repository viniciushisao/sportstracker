import { resolve } from 'node:path';
import { DateTime, IANAZone } from 'luxon';
import { JobError } from './errors.js';

export interface Config {
  university: boolean; universitySeason: string; dryRun: boolean; scheduled: boolean; date: string; timezone: string; season: string;
  recipient: string; errorRecipient: string; sender: string; smtpHost: string; smtpPort: number;
  smtpSecure: boolean; smtpUser: string; smtpPass: string; statePath: string; outputDir: string;
  fixtureDir?: string; urls: { men: string; women: string }; now: DateTime;
  resendReason?: string; publish?: boolean;
}
export function loadConfig(env: NodeJS.ProcessEnv, args: string[], now = DateTime.now()): Config {
  const flags = new Set(['--dry-run', '--send', '--scheduled', '--university', '--publish']);
  const values = new Set(['--date', '--fixtures', '--output', '--resend-reason']);
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (flags.has(arg)) options[arg] = 'true';
    else if (values.has(arg) && args[i + 1] && !args[i + 1]!.startsWith('--')) options[arg] = args[++i]!;
    else throw new JobError('CONFIG', 'Unknown argument or missing option value.', 'configuration');
  }
  const timezone = options['--university'] ? 'America/Toronto' : env.TIMEZONE || 'America/Toronto';
  if (!IANAZone.isValidZone(timezone)) throw new JobError('CONFIG', 'Invalid TIMEZONE.', 'configuration');
  const date = options['--date'] || now.setZone(timezone).toISODate()!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date, { zone: timezone }).isValid)
    throw new JobError('CONFIG', 'Invalid digest date.', 'configuration');
  if (options['--dry-run'] && options['--send']) throw new JobError('CONFIG', 'Choose dry-run or send, not both.', 'configuration');
  const boolean = (key: string, fallback: boolean) => {
    if (env[key] === undefined || env[key] === '') return fallback;
    if (!['true', 'false'].includes(env[key]!)) throw new JobError('CONFIG', `Invalid ${key}; use true or false.`, 'configuration');
    return env[key] === 'true';
  };
  const dryRun = !!options['--dry-run'] || (!options['--send'] && boolean('DRY_RUN', true));
  if (options['--fixtures'] && !dryRun) throw new JobError('CONFIG', 'Fixtures can only be used in dry-run mode.', 'configuration');
  if (options['--scheduled'] && (options['--date'] || options['--resend-reason'])) throw new JobError('CONFIG', 'Scheduled runs cannot override dates or resend.', 'configuration');
  if (options['--publish'] && (!options['--send'] || options['--scheduled'] || options['--resend-reason'] || options['--date']))
    throw new JobError('CONFIG', 'Publishing requires --send and cannot override date, schedule, or resend reason.', 'configuration');
  const season = env.CBV_SEASON || '2026-2027';
  if (!options['--university'] && (!/^20\d{2}-20\d{2}$/.test(season) || Number(season.slice(5)) !== Number(season.slice(0, 4)) + 1))
    throw new JobError('CONFIG', 'Invalid CBV_SEASON.', 'configuration');
  const universitySeason = env.UNIVERSITY_SEASON || '2026-2027';
  if (options['--university'] && (!/^20\d{2}-20\d{2}$/.test(universitySeason) || Number(universitySeason.slice(5)) !== Number(universitySeason.slice(0, 4)) + 1))
    throw new JobError('CONFIG', 'Invalid UNIVERSITY_SEASON.', 'configuration');
  const config: Config = {
    university: !!options['--university'], universitySeason, publish: !!options['--publish'],
    dryRun, scheduled: !!options['--scheduled'], date, timezone, season, now,
    recipient: env.EMAIL_TO || 'vinicius@hisao.com.br', errorRecipient: env.ERROR_EMAIL_TO || env.EMAIL_TO || 'vinicius@hisao.com.br',
    sender: env.EMAIL_FROM || '', smtpHost: env.SMTP_HOST || '', smtpPort: Number(env.SMTP_PORT || 587),
    smtpSecure: boolean('SMTP_SECURE', false), smtpUser: env.SMTP_USER || '', smtpPass: env.SMTP_PASS || '',
    statePath: resolve(options['--university'] ? env.UNIVERSITY_STATE_DB_PATH || `${env.STATE_DB_PATH || 'data/state.sqlite'}.university` : env.STATE_DB_PATH || 'data/state.sqlite'), outputDir: resolve(options['--output'] || (options['--university'] ? 'output/university' : 'output')),
    fixtureDir: options['--fixtures'], resendReason: options['--resend-reason'],
    urls: { men: env.CBV_MEN_URL || 'https://cbv.com.br/volei-de-quadra/superliga-a-masculina', women: env.CBV_WOMEN_URL || 'https://cbv.com.br/volei-de-quadra/superliga-a-feminina' },
  };
  const email = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
  if (![config.recipient, config.errorRecipient].every(v => email.test(v))) throw new JobError('CONFIG', 'Invalid recipient address.', 'configuration');
  if (!dryRun && (!email.test(config.sender) || !config.smtpHost || !config.smtpUser || !config.smtpPass || !Number.isInteger(config.smtpPort) || config.smtpPort < 1 || config.smtpPort > 65535))
    throw new JobError('CONFIG', 'Sending requires EMAIL_FROM and valid SMTP_HOST/PORT/USER/PASS.', 'configuration');
  return config;
}
export function isDue(config: Config): boolean {
  const local = config.now.setZone(config.timezone);
  return !config.scheduled || (local.hour === 16 && local.minute === 0);
}
