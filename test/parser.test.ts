import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageObjects, parseCompetition, standingsLink } from '../src/cbv/parse.js';
import { competition, fixture, modifiedPage, menUrl } from './helpers.js';
const parse = (games: string, standings = fixture('men-standings')) => parseCompetition(games, standings, 'men', '2026-2027', menUrl, menUrl + '/classificacao');
for (const gender of ['men', 'women'] as const) test(`real ${gender} pages provide complete schedule and standings`, () => {
  const data = competition(gender);
  assert.equal(data.matches.length, 132); assert.equal(data.standings.length, 12);
  assert.equal(new Set(data.matches.map(m => m.id)).size, 132);
  assert.ok(data.standings.every(s => s.points === 0));
  assert.equal(data.matches[0]!.startsAt, gender === 'men' ? '2026-10-24T21:30:00.000Z' : '2026-10-17T21:30:00.000Z');
});
test('finds the actual current standings navigation', () => assert.equal(standingsLink(fixture('men'), menUrl), menUrl + '/classificacao'));
test('historical official pages preserve completed scores and playoff games', () => {
  const data = parseCompetition(fixture('history'), fixture('history-standings'), 'men', '2025-2026', menUrl, menUrl + '/classificacao');
  assert.equal(data.matches.length, 147);
  assert.equal(data.matches[0]!.homeSets, 3); assert.equal(data.matches[0]!.awaySets, 1);
  assert.equal(data.matches[0]!.status, 'finished'); assert.equal(data.standings[0]!.points, 54);
  assert.ok(data.matches.some(m => m.phase.includes('SEMIFINAL')));
});
test('rejects stale season instead of silently substituting history', () => assert.throws(() => parse(fixture('history')), /season differs/));
test('rejects wrong competition', () => assert.throws(() => parse(fixture('women')), /competition/));
test('missing page data is not an empty day', () => assert.throws(() => pageObjects('<h1>No data</h1>'), /missing/));
test('truncated standings fail roster validation', () => {
  const html = modifiedPage('standings', d => d.teams.pop());
  assert.throws(() => parse(fixture('men'), html), /rosters differ/);
});
test('missing schedule match fails coverage', () => {
  const html = modifiedPage('games', d => d.matchesByRound['TURNO - RODADA 1'].pop());
  assert.throws(() => parse(html), /schedule is missing/);
});
test('identical duplicate records are deduplicated', () => {
  const html = modifiedPage('games', d => d.matchesByRound['TURNO - RODADA 1'].push(d.matchesByRound['TURNO - RODADA 1'][0]));
  assert.equal(parse(html).matches.length, 132);
});
test('conflicting duplicates fail', () => {
  const html = modifiedPage('games', d => d.matchesByRound['TURNO - RODADA 1'].push({ ...d.matchesByRound['TURNO - RODADA 1'][0], HomeTeam: 'Different' }));
  assert.throws(() => parse(html), /Conflicting/);
});
test('unknown time or timezone fails safely rather than inventing an instant', () => {
  for (const date of [null, '2026-10-24T18:30:00', '2026-02-30T18:30:00-03:00']) {
    assert.throws(() => parse(modifiedPage('games', d => d.matchesByRound['TURNO - RODADA 1'][0].MatchDateTime = date)));
  }
});
test('invalid score fails; live and postponed status preserved', () => {
  assert.throws(() => parse(modifiedPage('games', d => Object.assign(d.matchesByRound['TURNO - RODADA 1'][0], { isFinished: true, WonSetHome: 2, WonSetGuest: 2 }))), /score/);
  const live = parse(modifiedPage('games', d => Object.assign(d.matchesByRound['TURNO - RODADA 1'][0], { isLive: true, WonSetHome: 1 })));
  assert.equal(live.matches[0]!.status, 'live');
  const delayed = parse(modifiedPage('games', d => d.matchesByRound['TURNO - RODADA 1'][0].postponed = true));
  assert.equal(delayed.matches[0]!.status, 'postponed');
});
test('missing points are not interpreted as zero', () => assert.throws(() => parse(fixture('men'), modifiedPage('standings', d => delete d.teams[0].points)), /standings/));
