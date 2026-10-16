import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collect } from './cbv/fetch.js';
import { isDue, type Config } from './config.js';
import { render } from './email/render.js';
import { createMailer, MailError, type Mailer } from './email/transport.js';
import { acquireLock, State } from './state.js';
import { JobError, safeError } from './errors.js';
import type { Snapshot } from './types.js';
export interface Dependencies {
  collect: (config: Config, signal: AbortSignal) => Promise<Snapshot>;
  mailer: (config: Config) => Mailer;
  log: (data: Record<string, unknown>) => void;
}
const defaults: Dependencies = { collect, mailer: createMailer, log: value => console.log(JSON.stringify(value)) };
export async function runJob(config: Config, overrides: Partial<Dependencies> = {}): Promise<number> {
  const deps = { ...defaults, ...overrides };
  if (!isDue(config)) return 0;
  const runId = randomUUID(); const started = Date.now();
  let stage = 'lock'; let release: (() => Promise<void>) | null = null; let state: State | undefined; let mailer: Mailer | undefined;
  let errorAttempted = false;
  const controller = new AbortController();
  // Reserve the final 30 seconds of the ten-minute budget for reporting failures.
  const timer = setTimeout(() => controller.abort(new JobError('TIMEOUT', 'Daily job exceeded its processing budget.', stage)), 570_000);
  timer.unref();
  const key = JSON.stringify([config.recipient, config.date, config.timezone, 'digest']);
  const log = (event: string, more: Record<string, unknown> = {}) => deps.log({ runId, date: config.date, stage, event, ...more });
  try {
    if (!config.dryRun) {
      release = await acquireLock(config.statePath);
      if (!release) { log('locked_skip'); return 0; }
      stage = 'state'; state = new State(config.statePath); state.start(runId, config.date);
      const disposition = state.disposition(key);
      if (disposition === 'accepted' && !config.resendReason) { state.finish(runId, 'already_sent'); log('already_sent'); return 0; }
      if (disposition === 'ambiguous' && !config.resendReason) throw new JobError('DELIVERY_BLOCKED', 'Prior delivery outcome is uncertain; check provider records before retrying.', stage);
    }
    stage = 'fetch'; log('started');
    const snapshot = await deps.collect(config, controller.signal);
    controller.signal.throwIfAborted();
    log('validated', { competitions: snapshot.competitions.map(c => ({ competition: c.competition, matches: c.matches.length, teams: c.standings.length })) });
    stage = 'render'; const email = render(snapshot, config);
    if (config.dryRun) {
      await mkdir(config.outputDir, { recursive: true, mode: 0o700 });
      await writeFile(join(config.outputDir, 'digest.html'), email.html!, { mode: 0o600 });
      await writeFile(join(config.outputDir, 'digest.txt'), email.text, { mode: 0o600 });
      await writeFile(join(config.outputDir, 'snapshot.json'), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      log('preview_written', { outputDir: config.outputDir }); return 0;
    }
    stage = 'state'; state!.snapshot(runId, snapshot);
    const delivery = state!.prepare(key, runId, email, config.sender, config.resendReason);
    stage = 'email'; mailer = deps.mailer(config); state!.mark(delivery.id, 'sending');
    try { await mailer.send(email, config.recipient, delivery.messageId, controller.signal); }
    catch (error) { state!.mark(delivery.id, error instanceof MailError ? error.outcome : 'unknown'); throw error; }
    // A state-write failure leaves 'sending', intentionally preventing an automatic duplicate.
    state!.mark(delivery.id, 'accepted'); state!.finish(runId, 'accepted'); log('accepted', { messageId: delivery.messageId });
    return 0;
  } catch (error) {
    const detail = safeError(error); log('failed', { code: detail.code, message: detail.message });
    try { state?.finish(runId, 'failed', detail.code); } catch { log('state_error_record_failed'); }
    if (!config.dryRun && !errorAttempted) {
      errorAttempted = true;
      // Independent renderer and time budget; never include raw exceptions or credentials.
      const email = { subject: `[Sports Tracker] Failed — ${config.date}`, text: `The Superliga daily job failed.\nRun: ${runId}\nDate: ${config.date} (${config.timezone})\nStage: ${stage}\nCategory: ${detail.code}\n${detail.message}\n\nInspect the server logs and CBV source pages. For uncertain email delivery, check provider logs before resending.` };
      try {
        mailer?.close(); mailer = deps.mailer(config);
        await mailer.send(email, config.errorRecipient, `<${randomUUID()}@${config.sender.split('@')[1]}>`, AbortSignal.timeout(25_000));
        log('error_email_accepted');
      } catch { log('error_email_failed', { message: 'Error email could not be delivered; consult local logs.' }); }
    }
    return error instanceof JobError && error.code === 'CONFIG' ? 2 : 1;
  } finally {
    clearTimeout(timer);
    try { mailer?.close(); } catch { log('mailer_close_failed'); }
    try { state?.close(); } catch { log('state_close_failed'); }
    try { await release?.(); } catch { log('lock_release_failed'); }
    log('finished', { durationMs: Date.now() - started });
  }
}
