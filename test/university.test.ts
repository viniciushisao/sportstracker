import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { loadConfig, isDue } from '../src/config.js';
import { parseSchedule, scheduleSources, type UniversitySnapshot } from '../src/university/schedule.js';
import { collectUniversity, universityUrl } from '../src/university/fetch.js';
import { reminderGames, renderUniversity } from '../src/university/render.js';
import { runUniversityJob } from '../src/university/job.js';
import { runJob } from '../src/job.js';
import { fetchHtml } from '../src/cbv/fetch.js';
import { MailError } from '../src/email/transport.js';
import { snapshot as cbvSnapshot } from './helpers.js';

const sources = scheduleSources('2026-2027');
const fixture = async (id: string) => gunzipSync(await readFile(new URL(`fixtures/university/${id}.html.gz`, import.meta.url))).toString();
const config = (date: string) => loadConfig({}, ['--university', '--dry-run', '--date', date, '--fixtures', 'test/fixtures/university'], DateTime.fromISO(`${date}T16:00`, { zone: 'America/Toronto' }));
const snapshot = await collectUniversity(config('2026-10-30'), new AbortController().signal);
const baseGame = snapshot.games.find(g => g.sourceId === 'uoft-men' && g.date === '2026-10-30')!;
function withGames(...games: UniversitySnapshot['games']): UniversitySnapshot { return { ...snapshot, games }; }
async function modified(change: (row: any, $: ReturnType<typeof load>) => void) {
  const $ = load(await fixture('uoft-men'));
  const rows = $('tr.sidearm-schedule-game');
  const row = rows.filter('.sidearm-schedule-home-game').filter((_, el) => $(el).text().includes('October 30, 2026')).first();
  rows.not(row).remove(); change(row, $); return $.html();
}

test('all four official schedules yield home games only, with correct gyms and addresses', async () => {
  assert.deepEqual(snapshot.sources.map(s => [s.id, s.games]), [['uoft-men', 12], ['uoft-women', 15], ['tmu-men', 16], ['tmu-women', 13]]);
  for (const source of sources) {
    const $ = load(await fixture(source.id));
    const homeDates = $('tr.sidearm-schedule-home-game').map((_, el) => $(el).children('td').first().text().trim()).get();
    const games = snapshot.games.filter(g => g.sourceId === source.id);
    assert.ok(games.length <= homeDates.length);
    assert.ok(games.every(g => g.address && g.toronto));
  }
  // U of T's Toronto road game at York must not appear.
  assert.ok(!snapshot.games.some(g => g.sourceId === 'uoft-men' && g.date === '2026-09-19'));
  assert.equal(baseGame.address, '100 Devonshire Place, Toronto, ON');
});
test('home/away/neutral designation excludes Toronto away and neutral games', async () => {
  for (const at of ['Away', 'Neutral']) {
    const html = await modified(row => { row.children('td').eq(2).text(at); row.attr('class', `sidearm-schedule-game sidearm-schedule-${at.toLowerCase()}-game`); });
    assert.deepEqual(parseSchedule(html, sources[0]!, '2026-2027'), []);
  }
});
test('Toronto filter excludes a relocated home game outside Toronto and never assumes the usual gym', async () => {
  const html = await modified(row => row.children('td').eq(4).text('Mississauga, Ontario'));
  const games = parseSchedule(html, sources[0]!, '2026-2027');
  assert.equal(games[0]!.address, null);
  assert.deepEqual(reminderGames(withGames(...games), '2026-10-30'), []);
});
test('only previous-day and same-day digests include a match; no off-day email', () => {
  const s = withGames(baseGame);
  assert.equal(renderUniversity(s, config('2026-10-28')), null);
  assert.match(renderUniversity(s, config('2026-10-29'))!.text, /Tomorrow — 2026-10-30/);
  assert.match(renderUniversity(s, config('2026-10-30'))!.text, /Today — 2026-10-30/);
  assert.equal(renderUniversity(s, config('2026-10-31')), null);
});
test('Toronto calendar reminders span DST and year boundaries', () => {
  for (const [date, next] of [['2026-03-07', '2026-03-08'], ['2026-10-31', '2026-11-01'], ['2026-12-31', '2027-01-01']]) {
    assert.equal(reminderGames(withGames({ ...baseGame, date: next! }), date!).length, 1);
  }
  for (const instant of ['2026-07-01T20:00:00Z', '2026-12-01T21:00:00Z'])
    assert.ok(isDue(loadConfig({ TIMEZONE: 'UTC' }, ['--university', '--scheduled'], DateTime.fromISO(instant))));
  assert.ok(!isDue(loadConfig({}, ['--university', '--scheduled'], DateTime.fromISO('2026-12-01T20:00:00Z'))));
});
test('4 PM same-day email retains earlier starts and completed games with accurate labels', () => {
  const game = { ...baseGame, startsAt: '2026-10-30T13:30:00-04:00' };
  const email = renderUniversity(withGames(game), config('2026-10-30'))!;
  assert.match(email.text, /1:30 PM EDT/);
  assert.match(email.text, /Scheduled start has passed/);
  assert.match(renderUniversity(withGames({ ...game, status: 'finished', result: 'W, 3-0' }), config('2026-10-30'))!.text, /Final — W, 3-0/);
});
test('cancelled and postponed games do not produce normal reminders', async () => {
  for (const value of ['Cancelled', 'Postponed']) {
    const html = await modified(row => row.children('td').eq(7).text(value));
    const games = parseSchedule(html, sources[0]!, '2026-2027');
    assert.equal(games[0]!.status, value.toLowerCase());
    assert.equal(renderUniversity(withGames(...games), config('2026-10-30')), null);
  }
});
test('TBD time is explicit; unknown formats and locations fail visibly', async () => {
  const games = parseSchedule(await modified(row => row.children('td').eq(1).text('TBD')), sources[0]!, '2026-2027');
  assert.equal(games[0]!.startsAt, null);
  assert.match(renderUniversity(withGames(...games), config('2026-10-30'))!.text, /Time not announced/);
  assert.throws(() => reminderGames(withGames({ ...baseGame, venue: 'Venue not announced' }), '2026-10-30'));
  assert.throws(() => parseSchedule('<html>Challenge page</html>', sources[0]!, '2026-2027'));
  assert.throws(() => parseSchedule('bad', sources[0]!, '2026-2027'));
  const badTime = await modified(row => row.children('td').eq(1).text('after previous match'));
  assert.throws(() => parseSchedule(badTime, sources[0]!, '2026-2027'), /Unrecognized game time/);
});
test('wrong season, wrong gender, duplicate games and changed column layouts fail validation', async () => {
  const html = await fixture('uoft-women');
  assert.throws(() => parseSchedule(html, sources[0]!, '2026-2027'), /Wrong season or sport/);
  assert.throws(() => parseSchedule(html, sources[1]!, '2025-2026'), /Wrong season or sport/);
  const duplicate = await modified(row => row.after(row.clone()));
  assert.throws(() => parseSchedule(duplicate, sources[0]!, '2026-2027'), /Duplicate home game/);
  const truncated = await modified(row => row.children('td').last().remove());
  assert.throws(() => parseSchedule(truncated, sources[0]!, '2026-2027'), /Changed table columns/);
});
test('U of T versus TMU appears only from the hosting school, once per gender/date', () => {
  const matches = reminderGames(snapshot, '2027-01-29').filter(g => /Toronto Metropolitan/.test(g.opponent));
  assert.equal(matches.length, 2); // two dates, men's fixtures
  assert.ok(matches.every(g => g.sourceId.startsWith('uoft')));
  assert.equal(new Set(matches.map(g => `${g.gender}:${g.date}`)).size, matches.length);
});
test('conditional playoff and championship placeholders are excluded', () => {
  assert.ok(!snapshot.games.some(g => /Ontario University Athletics|U SPORTS Championship/.test(g.opponent)));
  assert.equal(reminderGames(snapshot, '2027-02-26').length, 0);
});
test('emails escape source content and reject unsafe ticket links', async () => {
  const html = await modified(row => row.find('.sidearm-schedule-game-links-tickets a').attr('href', 'javascript:alert(1)'));
  assert.equal(parseSchedule(html, sources[0]!, '2026-2027')[0]!.ticketUrl, null);
  const email = renderUniversity(withGames({ ...baseGame, opponent: '<script>bad</script>' }), config('2026-10-30'))!;
  assert.ok(!email.html!.includes('<script>'));
  assert.match(email.html!, /&lt;script&gt;/);
});
test('university URL policy rejects external redirects and preserves CBV restriction', async () => {
  for (const url of ['http://varsityblues.ca', 'https://evil.example', 'https://tmubold.ca.evil.example', 'https://user@tmubold.ca']) assert.throws(() => universityUrl(url));
  await assert.rejects(fetchHtml(sources[0]!.url, new AbortController().signal, async () => new Response('', { status: 302, headers: { location: 'https://evil.example/' } }), universityUrl));
  await assert.rejects(fetchHtml(sources[0]!.url, new AbortController().signal));
});
async function sending(t: any, date = '2026-10-30') {
  const dir = await mkdtemp(join(tmpdir(), 'university-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  return loadConfig({ EMAIL_FROM: 'tracker@example.org', SMTP_HOST: 'smtp.example.org', SMTP_USER: 'user', SMTP_PASS: 'secret', STATE_DB_PATH: join(dir, 'state.sqlite') }, ['--university', '--send', '--date', date, '--output', join(dir, 'preview')]);
}
test('university state and lock paths are independent from the simultaneous Superliga job', () => {
  const env = { STATE_DB_PATH: '/tmp/sports-state.sqlite' };
  assert.notEqual(loadConfig(env, []).statePath, loadConfig(env, ['--university']).statePath);
  assert.equal(loadConfig({ ...env, UNIVERSITY_STATE_DB_PATH: '/tmp/university.sqlite' }, ['--university']).statePath, '/tmp/university.sqlite');
});
test('day-before and game-day deliveries send once each; shared database keys cannot suppress Superliga', async t => {
  const c = await sending(t, '2026-10-29'); const emails: any[] = [];
  const deps = { collect: async () => withGames(baseGame), log: () => {}, mailer: () => ({ send: async (email: any) => { emails.push(email); }, close() {} }) };
  assert.equal(await runUniversityJob(c, deps), 0);
  assert.equal(await runUniversityJob(c, deps), 0);
  c.date = '2026-10-30'; assert.equal(await runUniversityJob(c, deps), 0);
  assert.equal(await runUniversityJob(c, deps), 0);
  assert.equal(emails.length, 2);
  assert.equal(await runJob(c, { ...deps, collect: async () => cbvSnapshot() }), 0);
  assert.equal(emails.length, 3);
});
test('no-game run sends a health report; dry-run writes a preview without delivery or state', async t => {
  const c = await sending(t); let sent = 0;
  const deps = { collect: async () => withGames(), log: () => {}, mailer: () => ({ send: async () => { sent++; }, close() {} }) };
  assert.equal(await runUniversityJob(c, deps), 0); assert.equal(sent, 1);
  c.statePath += '.preview'; c.dryRun = true;
  assert.equal(await runUniversityJob(c, { ...deps, collect: async () => withGames(baseGame) }), 0);
  assert.equal(sent, 1); await access(join(c.outputDir, 'digest.html')); await assert.rejects(access(c.statePath));
});
test('source failure produces an error, not a misleading empty-day result', async t => {
  const c = await sending(t); const emails: any[] = [];
  const result = await runUniversityJob(c, { collect: async () => { throw new Error('source unavailable'); }, log: () => {}, mailer: () => ({ send: async email => { emails.push(email); }, close() {} }) });
  assert.equal(result, 1); assert.equal(emails.length, 1); assert.match(emails[0].text, /University volleyball daily job failed/);
});
test('uncertain university SMTP delivery is never automatically repeated', async t => {
  const c = await sending(t); let attempts = 0;
  const deps = { collect: async () => withGames(baseGame), log: () => {}, mailer: () => ({ send: async (email: any) => { if (email.subject.startsWith('Toronto')) { attempts++; throw new MailError('unknown'); } }, close() {} }) };
  assert.equal(await runUniversityJob(c, deps), 1); assert.equal(await runUniversityJob(c, deps), 1); assert.equal(attempts, 1);
});
