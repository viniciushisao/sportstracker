import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { dayMatches, render } from '../src/email/render.js';
import { loadConfig, isDue } from '../src/config.js';
import { snapshot } from './helpers.js';
const base = snapshot();
test('reference date includes both competitions and all standings', () => {
  const email = render(base, { date: '2026-10-26', timezone: 'America/Toronto', season: '2026-2027' });
  assert.match(email.text, /7:00 PM BRT \(UTC−3\) — MONTES CLAROS/);
  assert.match(email.text, /9:00 PM BRT \(UTC−3\) — NORDE/);
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

test('first-leg-only digest explains coverage even beyond publication', () => {
  const s = structuredClone(base);
  const men = s.competitions[0]!;
  men.matches = men.matches.filter(m => m.phase.startsWith('TURNO'));
  men.firstLegOnly = true;
  const config = { date: '2026-10-26', timezone: 'America/Toronto', season: '2026-2027' };
  assert.match(render(s, config).text, /first-leg schedule only/);
  assert.match(render(s, { ...config, date: '2027-06-01' }).text, /coverage is incomplete/);
});

test('round labels count both legs and preserve playoff phases', () => {
  for (const [phase, expected] of [['TURNO - RODADA 8', 'Round 8/22'], ['RETURNO - RODADA 8', 'Round 19/22'], ['SEMIFINAL', 'SEMIFINAL']]) {
    const s = structuredClone(base);
    Object.assign(s.competitions[0]!.matches[0]!, { phase, startsAt: '2026-10-26T14:00:00Z' });
    const email = render(s, { date: '2026-10-26', timezone: 'America/Toronto', season: '2026-2027' });
    assert.ok(email.html!.includes(expected!));
    assert.ok(email.text.includes(expected!));
  }
});
test('standings include played, won, lost and points in both formats', () => {
  const s = structuredClone(base);
  Object.assign(s.competitions[0]!.standings[0]!, { played: 22, wins: 17, losses: 5, points: 54 });
  const email = render(s, { date: '2026-10-26', timezone: 'America/Toronto', season: '2026-2027' });
  assert.match(email.text, /T 22 · W 17 · L 5 · P 54/);
  for (const label of ['T', 'W', 'L', 'P']) assert.ok(email.html!.includes(`>${label}</th>`));
});

test('today shows escaped broadcasters, missing details and converted BRT times', () => {
  const s = structuredClone(base);
  const match = s.competitions[0]!.matches[0]!;
  Object.assign(match, { startsAt: '2026-10-26T22:00:00Z', broadcasters: ['SporTV 2', '<TV>'] });
  const config = { date: '2026-10-26', timezone: 'America/Toronto', season: '2026-2027' };
  const email = render(s, config);
  assert.match(email.text, /7:00 PM BRT \(UTC−3\)/);
  assert.match(email.text, /Watch: SporTV 2, <TV>/);
  assert.match(email.html!, /SporTV 2, &lt;TV&gt;/);
  match.broadcasters = [];
  assert.match(render(s, config).text, /Watch: Not announced/);
  match.startsAt = '2026-10-27T03:00:00Z';
  assert.match(render(s, config).text, /Oct 27 · 12:00 AM BRT/);
});
