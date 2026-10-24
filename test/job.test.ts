import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.js';
import { runJob } from '../src/job.js';
import { State, acquireLock } from '../src/state.js';
import { MailError, classifyMailError } from '../src/email/transport.js';
import { JobError } from '../src/errors.js';
import { snapshot } from './helpers.js';
const data = snapshot();
async function setup(t: any) {
  const dir = await mkdtemp(join(tmpdir(), 'sportstracker-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  return loadConfig({ EMAIL_FROM: 'tracker@example.org', SMTP_HOST: 'smtp.example.org', SMTP_USER: 'user', SMTP_PASS: 'do-not-log', STATE_DB_PATH: join(dir, 'state.sqlite') }, ['--send', '--date', '2026-10-26', '--output', join(dir, 'preview')]);
}
test('normal run sends once; subsequent run skips and retains accepted state', async t => {
  const c = await setup(t); const sent: any[] = [];
  const deps = { collect: async () => data, log: () => {}, mailer: () => ({ send: async (...args: any[]) => { sent.push(args); }, close() {} }) };
  assert.equal(await runJob(c, deps), 0); assert.equal(await runJob(c, deps), 0);
  assert.equal(sent.length, 1); assert.equal(sent[0][1], 'vinicius@hisao.com.br');
  const db = new DatabaseSync(c.statePath); assert.equal(db.prepare("SELECT count(*) n FROM deliveries WHERE status='accepted'").get()!.n, 1); db.close();
});
test('dry-run generates preview without SMTP, database, or lock', async t => {
  const c = await setup(t); c.dryRun = true;
  assert.equal(await runJob(c, { collect: async () => data, log: () => {}, mailer: () => { throw new Error('must not create transport'); } }), 0);
  await access(join(c.outputDir, 'digest.html')); await assert.rejects(access(c.statePath)); await assert.rejects(access(c.statePath + '.lock'));
});
test('source failure sends only an error notification and exits nonzero', async t => {
  const c = await setup(t); const emails: any[] = [];
  assert.equal(await runJob(c, { collect: async () => { throw new JobError('PAGE_FORMAT', 'Page changed.'); }, log: () => {}, mailer: () => ({ send: async email => { emails.push(email); }, close() {} }) }), 1);
  assert.equal(emails.length, 1); assert.match(emails[0].subject, /Failed/); assert.match(emails[0].text, /PAGE_FORMAT/);
});
test('unknown exceptions are sanitized; failed error email does not recurse', async t => {
  const c = await setup(t); const logs: any[] = []; let sends = 0;
  await runJob(c, { collect: async () => { throw new Error('smtp password do-not-log'); }, log: x => logs.push(x), mailer: () => ({ send: async () => { sends++; throw new Error('secret'); }, close() {} }) });
  assert.equal(sends, 1); assert.ok(!JSON.stringify(logs).includes('do-not-log')); assert.ok(logs.some(l => l.event === 'error_email_failed'));
});
test('ambiguous SMTP delivery prevents automatic digest resend', async t => {
  const c = await setup(t); const subjects: string[] = [];
  const deps = { collect: async () => data, log: () => {}, mailer: () => ({ send: async (email: any) => { subjects.push(email.subject); if (email.subject.startsWith('Superliga')) throw new MailError('unknown'); }, close() {} }) };
  assert.equal(await runJob(c, deps), 1); assert.equal(await runJob(c, deps), 1);
  assert.equal(subjects.filter(s => s.startsWith('Superliga')).length, 1);
});
test('concurrent job skips while first holds the lock', async t => {
  const c = await setup(t); let releaseFetch!: () => void; let started!: () => void;
  const arrived = new Promise<void>(r => { started = r; }); const barrier = new Promise<void>(r => { releaseFetch = r; }); let sent = 0;
  const deps = { collect: async () => { started(); await barrier; return data; }, log: () => {}, mailer: () => ({ send: async () => { sent++; }, close() {} }) };
  const first = runJob(c, deps); await arrived;
  assert.equal(await runJob(c, deps), 0); releaseFetch(); assert.equal(await first, 0); assert.equal(sent, 1);
});
test('crash-era sending record blocks sends until deliberate audited override', async t => {
  const c = await setup(t); const release = await acquireLock(c.statePath); const state = new State(c.statePath);
  const key = JSON.stringify([c.recipient, c.date, c.timezone, 'digest']); state.start('old-run', c.date);
  const first = state.prepare(key, 'old-run', { subject: 'x', text: 'x' }, c.sender); state.mark(first.id, 'sending');
  assert.equal(state.disposition(key), 'ambiguous'); assert.throws(() => state.prepare(key, 'old-run', {subject:'x',text:'x'}, c.sender));
  const next = state.prepare(key, 'old-run', { subject: 'x', text: 'x' }, c.sender, 'Provider confirmed no delivery');
  assert.notEqual(first.messageId, next.messageId); state.close(); await release!();
});
test('SMTP response classification never retries a lost DATA reply', () => {
  assert.deepEqual(classifyMailError({code:'ETIMEDOUT',command:'DATA'}), {outcome:'unknown',retry:false});
  assert.deepEqual(classifyMailError({responseCode:450,command:'RCPT TO'}), {outcome:'rejected',retry:true});
  assert.deepEqual(classifyMailError({responseCode:535,command:'AUTH PLAIN'}), {outcome:'rejected',retry:false});
});

test('stale lock reports an error instead of silently skipping forever', async t => {
  const { utimes } = await import('node:fs/promises');
  const c = await setup(t); const release = await acquireLock(c.statePath);
  const old = new Date(Date.now() - 12 * 60_000); await utimes(c.statePath + '.lock', old, old);
  let errors = 0;
  assert.equal(await runJob(c, { collect: async () => { throw new Error('must not fetch'); }, log: () => {}, mailer: () => ({ send: async email => { assert.match(email.text, /STALE_LOCK/); errors++; }, close() {} }) }), 1);
  assert.equal(errors, 1); await release!();
});
test('invalid job config can notify with separately validated SMTP settings', async t => {
  const { reportConfigError } = await import('../src/email/config-error.js');
  const c = await setup(t); let sent = 0;
  const env = { DRY_RUN: 'false', TIMEZONE: 'invalid', EMAIL_FROM:c.sender, SMTP_HOST:c.smtpHost, SMTP_USER:c.smtpUser, SMTP_PASS:c.smtpPass };
  const factory = () => ({ send: async () => { sent++; }, close() {} });
  assert.equal(await reportConfigError(env, [], new JobError('CONFIG', 'Invalid TIMEZONE.'), factory), 'accepted');
  assert.equal(sent, 1);
  assert.equal(await reportConfigError(env, ['--dry-run'], new Error('x'), factory), 'skipped');
  assert.equal(await reportConfigError({...env, SMTP_PASS:''}, [], new Error('x'), factory), 'failed');
  assert.equal(sent, 1);
});

test('each publication sends a fresh digest while normal daily runs still skip', async t => {
  const c = await setup(t); let sent = 0;
  const deps = { collect: async () => data, log() {}, mailer: () => ({ send: async () => { sent++; }, close() {} }) };
  assert.equal(await runJob(c, deps), 0);
  c.publish = true;
  assert.equal(await runJob(c, deps), 0);
  assert.equal(await runJob(c, deps), 0);
  c.publish = false;
  assert.equal(await runJob(c, deps), 0);
  assert.equal(sent, 3);
});

test('publication cannot override uncertain delivery and reports active locks', async t => {
  const c = await setup(t); c.publish = true;
  let digests = 0;
  const deps = { collect: async () => data, log() {}, mailer: () => ({
    send: async (email: any) => { if (email.subject.startsWith('Superliga')) { digests++; throw new MailError('unknown'); } }, close() {},
  }) };
  assert.equal(await runJob(c, deps), 1);
  assert.equal(await runJob(c, deps), 1);
  assert.equal(digests, 1);
  const release = await acquireLock(c.statePath);
  try { assert.equal(await runJob(c, deps), 1); } finally { await release!(); }
});

test('publication flags reject dry-run, schedule, historical date and manual overrides', () => {
  for (const args of [
    ['--publish'], ['--publish', '--dry-run'], ['--publish', '--send', '--scheduled'],
    ['--publish', '--send', '--date', '2026-10-24'],
    ['--publish', '--send', '--resend-reason', 'override'],
  ]) assert.throws(() => loadConfig({}, args));
});
