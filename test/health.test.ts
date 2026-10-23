import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { runJob } from '../src/job.js';
import { runUniversityJob } from '../src/university/job.js';
import { checkSuperligaParser, checkUniversityParser } from '../src/parser-health.js';
import { healthEmail } from '../src/email/health.js';
import { JobError } from '../src/errors.js';
import { snapshot } from './helpers.js';

for (const [label, run, data, checker] of [
  ['Superliga', runJob, snapshot(), checkSuperligaParser],
  ['University', runUniversityJob, { fetchedAt: '2026-10-15T20:00:00Z', sources: [], games: [] }, checkUniversityParser],
] as const) {
  test(`${label}: saved-example parser checks pass and honour cancellation`, async () => {
    await checker(new AbortController().signal);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(checker(controller.signal), /saved-example parser checks failed/);
  });
  for (const fail of [false, true]) test(`${label}: no-game ${fail ? 'parser failure never sends all-clear' : 'day sends a verified all-clear once'}`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'health-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const c = loadConfig({ EMAIL_FROM: 'tracker@example.org', SMTP_HOST: 'smtp.example.org', SMTP_USER: 'user', SMTP_PASS: 'secret', STATE_DB_PATH: join(dir, 'state.sqlite') }, ['--send', '--date', '2026-10-15']);
    const emails: any[] = []; let checks = 0;
    const deps = { collect: async (): Promise<any> => data, checkParser: async () => { checks++; if (fail) throw new JobError('PARSER_HEALTH', 'Saved parser example failed.'); await checker(new AbortController().signal); }, log() {}, mailer: () => ({ send: async (email: any) => { emails.push(email); }, close() {} }) };
    assert.equal(await run(c, deps), fail ? 1 : 0);
    assert.equal(checks, 1); assert.equal(emails.length, 1);
    if (fail) { assert.match(emails[0].text, /PARSER_HEALTH/); assert.ok(!emails[0].text.includes('Everything looks fine')); }
    else {
      assert.match(emails[0].text, /Everything looks fine/);
      assert.match(emails[0].text, /Current official schedules fetched and validated/);
      assert.match(emails[0].html, /saved examples passed/);
      if (label === 'Superliga') assert.match(emails[0].text, /Men's standings/);
      assert.equal(await run(c, deps), 0); assert.equal(emails.length, 1); assert.equal(checks, 1);
    }
  });
  test(`${label}: source failure cannot claim parser health or all-clear`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'health-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const c = loadConfig({ EMAIL_FROM: 'tracker@example.org', SMTP_HOST: 'smtp.example.org', SMTP_USER: 'user', SMTP_PASS: 'secret', STATE_DB_PATH: join(dir, 'state.sqlite') }, ['--send', '--date', '2026-10-15']);
    const emails: any[] = [];
    assert.equal(await run(c, { collect: async () => { throw new JobError('FETCH_FAILED', 'Schedule unavailable.'); }, checkParser: async () => { throw new Error('must not run'); }, log() {}, mailer: () => ({ send: async (email: any) => { emails.push(email); }, close() {} }) }), 1);
    assert.equal(emails.length, 1); assert.match(emails[0].text, /FETCH_FAILED/); assert.ok(!emails[0].text.includes('Everything looks fine'));
  });
}
test('offline health preview never claims a live source check', () => {
  const c = loadConfig({}, ['--dry-run', '--fixtures', 'test/fixtures/university']);
  const email = healthEmail(null, 'University volleyball', c);
  assert.match(email.text, /live sources were not contacted/);
  assert.ok(!email.text.includes('Current official schedules fetched'));
});
