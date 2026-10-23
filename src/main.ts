import { config as dotenv } from 'dotenv';
import { DateTime, IANAZone } from 'luxon';
import { loadConfig } from './config.js';
import { runJob } from './job.js';
import { runUniversityJob } from './university/job.js';
import { safeError } from './errors.js';
import { reportConfigError } from './email/config-error.js';

process.umask(0o077);
dotenv({ path: process.env.ENV_FILE || '.env', quiet: true });
// Hard cap also covers an unexpectedly hung library. A crash leaves a lock and a
// conservative delivery state; operators must reconcile before clearing either.
const hardLimit = setTimeout(() => {
  console.error(JSON.stringify({ event: 'hard_timeout', message: 'Ten-minute job limit exceeded; inspect lock and delivery state.' }));
  process.exit(1);
}, 600_000);
hardLimit.unref();
try {
  const args = process.argv.slice(2);
  const now = DateTime.now();
  const zone = args.includes('--university') ? 'America/Toronto' : IANAZone.isValidZone(process.env.TIMEZONE || '') ? process.env.TIMEZONE! : 'America/Toronto';
  const local = now.setZone(zone);
  // Gate before validating mail settings to avoid per-minute error notifications
  // when the hosting scheduler invokes a misconfigured job throughout the day.
  if (args.includes('--scheduled') && (local.hour !== 16 || local.minute !== 0)) process.exitCode = 0;
  else {
    const configuration = loadConfig(process.env, args, now);
    process.exitCode = await (configuration.university ? runUniversityJob(configuration) : runJob(configuration));
  }
} catch (error) {
  console.error(JSON.stringify({ event: 'configuration_failed', ...safeError(error) }));
  const notification = await reportConfigError(process.env, process.argv.slice(2), error);
  console.error(JSON.stringify({ event: 'configuration_error_email', status: notification }));
  process.exitCode = 2;
} finally { clearTimeout(hardLimit); }
