import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { runJob } from '../src/job.js';
import { runUniversityJob } from '../src/university/job.js';
import { healthEmail } from '../src/email/health.js';
import { JobError } from '../src/errors.js';
import { snapshot } from './helpers.js';

for (const [label, run, data] of [
  ['Superliga', runJob, snapshot()],
  ['University', runUniversityJob, { fetchedAt: '2026-10-15T20:00:00Z', sources: [], games: [] }],
] as const) {
  for (const fail of [false, true]) test(`${label}: ${fail ? 'live parser failure never sends all-clear' : 'no-game day sends a health report once without running tests'}`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'health-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const c = loadConfig({ EMAIL_FROM: 'tracker@example.org', SMTP_HOST: 'smtp.example.org', SMTP_USER: 'user', SMTP_PASS: 'secret', STATE_DB_PATH: join(dir, 'state.sqlite') }, ['--send', '--date', '2026-10-15']);
    const emails: any[] = []; let collections = 0;
    const deps = {
      collect: async (): Promise<any> => { collections++; if (fail) throw new JobError('PAGE_FORMAT', 'Current schedule could not be parsed.'); return data; },
      // Regression guard: the removed runtime test hook must never be called.
      checkParser: async () => { throw new Error('Daily jobs must not run tests'); },
      log() {}, mailer: () => ({ send: async (email: any) => { emails.push(email); }, close() {} }),
    };
    assert.equal(await run(c, deps), fail ? 1 : 0);
    assert.equal(collections, 1); assert.equal(emails.length, 1);
    if (fail) { assert.match(emails[0].text, /PAGE_FORMAT/); assert.ok(!emails[0].text.includes('Health check OK')); }
    else {
      assert.match(emails[0].text, /Health check OK/);
      assert.match(emails[0].text, /Current official schedules fetched and validated/);
      assert.ok(!emails[0].text.includes('saved examples'));
      if (label === 'Superliga') assert.match(emails[0].text, /Men's standings/);
      assert.equal(await run(c, deps), 0); assert.equal(emails.length, 1); assert.equal(collections, 1);
    }
  });
}
test('offline health preview never claims a live source check', () => {
  const c = loadConfig({}, ['--dry-run', '--fixtures', 'test/fixtures/university']);
  const email = healthEmail(null, 'University volleyball', c);
  assert.match(email.text, /live sources were not contacted/);
  assert.ok(!email.text.includes('Current official schedules fetched'));
});
