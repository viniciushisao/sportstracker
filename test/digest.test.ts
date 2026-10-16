import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { dayMatches, render } from '../src/email/render.js';
import { loadConfig, isDue } from '../src/config.js';
import { snapshot } from './helpers.js';
const base = snapshot();
test('reference date includes both competitions and all standings', () => {
  const email = render(base, { date: '2026-10-26', timezone: 'America/Toronto', season: '2026-2027' });
  assert.match(email.text, /6:00 PM — MONTES CLAROS/);
  assert.match(email.text, /8:00 PM — NORDE/);
  assert.match(email.text, /SANCOR SEGUROS VOLEI/);
  for (const c of base.competitions) for (const team of c.standings) assert.ok(email.text.includes(team.team.name));
  assert.match(email.text, /America\/Toronto/);
});
test('spring-forward and fall-back days use local calendar boundaries', () => {
  for (const [date, times, expected] of [
    ['2026-03-08', ['2026-03-08T04:59:00Z', '2026-03-08T05:00:00Z', '2026-03-09T03:59:00Z', '2026-03-09T04:00:00Z'], 2],
    ['2026-11-01', ['2026-11-01T03:59:00Z', '2026-11-01T04:00:00Z', '2026-11-02T04:59:00Z', '2026-11-02T05:00:00Z'], 2],
  ] as const) {
    const s = structuredClone(base); s.competitions = [s.competitions[0]!];
    s.competitions[0]!.matches = times.map((time, i) => ({ ...base.competitions[0]!.matches[0]!, startsAt: time, id: String(i) }));
    assert.equal(dayMatches(s, date, 'America/Toronto').length, expected);
  }
});
test('yesterday across a year boundary includes pending results', () => {
  const s = structuredClone(base); s.competitions[0]!.matches = [{ ...s.competitions[0]!.matches[0]!, startsAt: '2027-01-01T01:00:00Z' }];
  const email = render(s, { date: '2027-01-01', timezone: 'America/Toronto', season: '2026-2027' });
  assert.match(email.text, /Result pending/);
});
test('completed earlier-today match remains in today section and HTML escapes source names', () => {
  const s = structuredClone(base); s.competitions[0]!.matches[0] = { ...s.competitions[0]!.matches[0]!, startsAt: '2026-10-26T14:00:00Z', status: 'finished', homeSets: 3, awaySets: 1, home: { id: 'x', name: '<script>alert(1)</script>' } };
  const email = render(s, { date: '2026-10-26', timezone: 'America/Toronto', season: '2026-2027' });
  assert.ok(!email.html!.includes('<script>')); assert.match(email.html!, /&lt;script&gt;/); assert.match(email.text, /3 × 1/);
});
test('validated no-game day has explicit empty states', () => {
  const email = render(base, { date: '2026-10-15', timezone: 'America/Toronto', season: '2026-2027' });
  assert.match(email.text, /No games scheduled today/); assert.match(email.text, /No games yesterday/);
});
test('scheduler gate follows Toronto daylight-saving time', () => {
  for (const instant of ['2026-07-01T20:00:00Z', '2026-12-01T21:00:00Z']) assert.ok(isDue(loadConfig({}, ['--scheduled'], DateTime.fromISO(instant))));
  assert.ok(!isDue(loadConfig({}, ['--scheduled'], DateTime.fromISO('2026-12-01T20:00:00Z'))));
});
test('configuration defaults to safe dry-run and rejects unsafe combinations', () => {
  assert.equal(loadConfig({}, []).dryRun, true);
  for (const args of [['--send'], ['--send', '--dry-run'], ['--fixtures','x','--send'], ['--scheduled','--date','2026-10-26'], ['--unknown']]) assert.throws(() => loadConfig({}, args));
  assert.throws(() => loadConfig({ TIMEZONE: 'bad' }, []));
  assert.throws(() => loadConfig({ DRY_RUN: 'False' }, []));
});
