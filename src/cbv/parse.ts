import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { assert, JobError } from '../errors.js';
import type { Competition, CompetitionData, Match } from '../types.js';

// Parse only JSON literals from Next's HTML hydration stream. Never evaluate website JavaScript.
export function pageObjects(html: string): Record<string, unknown>[] {
  const $ = load(html);
  const chunks: string[] = [];
  $('script').each((_, script) => {
    const text = $(script).html() || '';
    const match = /^self\.__next_f\.push\((\[.*\])\)\s*;?$/s.exec(text.trim());
    if (!match) return;
    try {
      const chunk: unknown = JSON.parse(match[1]!);
      if (Array.isArray(chunk) && chunk[0] === 1 && typeof chunk[1] === 'string') chunks.push(chunk[1]);
    } catch { throw new JobError('PAGE_FORMAT', 'Invalid CBV page hydration data.', 'parser'); }
  });
  const objects: Record<string, unknown>[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      objects.push(value as Record<string, unknown>);
      Object.values(value).forEach(visit);
    }
  }
  for (const line of chunks.join('').split('\n')) {
    const match = /^[0-9a-f]+:(\[.*|\{.*)$/.exec(line);
    if (!match) continue;
    try { visit(JSON.parse(match[1]!)); } catch { /* Non-JSON Flight records are not data candidates. */ }
  }
  assert(objects.length > 0, 'PAGE_FORMAT', 'CBV embedded page data is missing.');
  return objects;
}
const name = z.string().trim().min(1).max(200);
const id = z.number().int().positive();
const rawMatch = z.object({
  ChampionshipMatch_ID: id, Championship_ID: id, HomeTeam_ID: id, GuestTeam_ID: id,
  HomeTeam: name, GuestTeam: name, RoundType: name,
  MatchDateTime: z.string().regex(/T.*(?:Z|[+-]\d{2}:\d{2})$/),
  WonSetHome: z.number().int().min(0).max(3), WonSetGuest: z.number().int().min(0).max(3),
  postponed: z.boolean(), isLive: z.boolean(), isFinished: z.boolean(),
  HomeDisqualification: z.boolean(), GuestDisqualification: z.boolean(),
});
const rawStanding = z.object({ teamId: z.string().regex(/^\d+$/), teamName: name,
  position: z.number().int().positive(), points: z.number().int(), matches: z.number().int().nonnegative() });

function validateIdentity(html: string, competition: Competition, season: string): void {
  const $ = load(html); $('script,style').remove();
  const text = $.text().replace(/\s+/g, ' ');
  const identity = /Superliga\s*(Masculina|Feminina)/.exec(text);
  assert(identity?.[1] === (competition === 'men' ? 'Masculina' : 'Feminina'), 'COMPETITION', 'Unexpected CBV competition page.');
  const first = /(?:Temporada|temporada)\s+(\d{2,4})\/(\d{2,4})/.exec(text);
  assert(first, 'SEASON', 'The page does not identify its season.');
  const full = (v: string) => v.length === 2 ? `20${v}` : v;
  assert(`${full(first[1]!)}-${full(first[2]!)}` === season, 'SEASON', 'CBV page season differs from configured season.');
}
export function standingsLink(html: string, base: string): string {
  const $ = load(html);
  const links = $('a[href]').map((_, e) => $(e).attr('href')).get();
  const target = links.find(h => h === `${new URL(base).pathname}/classificacao`);
  assert(target, 'STANDINGS_LINK', 'Current competition standings link is missing.');
  return new URL(target, base).href;
}
export function parseCompetition(gamesHtml: string, standingsHtml: string, competition: Competition, season: string, sourceUrl: string, standingsUrl: string): CompetitionData {
  validateIdentity(gamesHtml, competition, season);
  validateIdentity(standingsHtml, competition, season);
  const schedule = pageObjects(gamesHtml).filter(o => o.matchesByRound && typeof o.matchesByRound === 'object');
  assert(schedule.length === 1, 'SCHEDULE', 'Expected one full CBV schedule grouped by round.');
  const maps = Array.isArray(schedule[0]!.matchesByRound) ? schedule[0]!.matchesByRound : [schedule[0]!.matchesByRound];
  const matches = new Map<string, Match>(); const rounds: string[] = []; const championshipIds = new Set<number>();
  for (const map of maps as Record<string, unknown>[]) {
    for (const [round, entries] of Object.entries(map)) {
      assert(Array.isArray(entries) && entries.length > 0, 'ROUND', 'CBV round data is missing or unresolved.');
      rounds.push(round);
      for (const entry of entries) {
        const result = rawMatch.safeParse(entry);
        assert(result.success, 'MATCH_SCHEMA', 'Required CBV match fields are missing, ambiguous, or changed.');
        const raw = result.data;
        assert(!raw.HomeDisqualification && !raw.GuestDisqualification, 'ADMIN_RESULT', 'An administrative result requires adapter review.');
        const time = DateTime.fromISO(raw.MatchDateTime, { setZone: true });
        assert(time.isValid, 'MATCH_DATE', 'Invalid match timestamp.');
        assert(time.year >= Number(season.slice(0, 4)) && time.year <= Number(season.slice(5)), 'MATCH_DATE', 'Match date falls outside configured season years.');
        const finished = raw.isFinished;
        assert(!finished || (Math.max(raw.WonSetHome, raw.WonSetGuest) === 3 && Math.min(raw.WonSetHome, raw.WonSetGuest) < 3), 'SCORE', 'Invalid final set score.');
        assert(!(raw.isLive && finished), 'STATUS', 'Contradictory match status.');
        championshipIds.add(raw.Championship_ID);
        const prefix = `${competition}:${season}:`;
        const match: Match = { id: prefix + raw.ChampionshipMatch_ID, competition, season, phase: raw.RoundType,
          home: { id: prefix + raw.HomeTeam_ID, name: raw.HomeTeam.normalize('NFC').replace(/\s+/g, ' ') },
          away: { id: prefix + raw.GuestTeam_ID, name: raw.GuestTeam.normalize('NFC').replace(/\s+/g, ' ') },
          startsAt: time.toUTC().toISO()!, status: raw.postponed ? 'postponed' : finished ? 'finished' : raw.isLive ? 'live' : 'scheduled',
          homeSets: finished || raw.isLive ? raw.WonSetHome : null, awaySets: finished || raw.isLive ? raw.WonSetGuest : null, sourceUrl };
        assert(match.home.id !== match.away.id, 'TEAM', 'A match cannot have the same team on both sides.');
        const previous = matches.get(match.id);
        assert(!previous || JSON.stringify(previous) === JSON.stringify(match), 'DUPLICATE', 'Conflicting duplicate CBV match.');
        matches.set(match.id, match);
      }
    }
  }
  assert(championshipIds.size === 1 && matches.size > 0, 'CHAMPIONSHIP', 'Schedule has missing or mixed championship IDs.');
  const championshipId = [...championshipIds][0]!;
  const tables = pageObjects(standingsHtml).filter(o => o.championshipId === championshipId && Array.isArray(o.teams));
  assert(tables.length === 1, 'STANDINGS', 'Expected complete standings for the schedule championship.');
  const parsed = z.array(rawStanding).safeParse(tables[0]!.teams);
  assert(parsed.success && parsed.data.length >= 2, 'STANDINGS', 'Invalid or empty standings.');
  const standings = parsed.data.map(row => ({ rank: row.position, team: { id: `${competition}:${season}:${row.teamId}`, name: row.teamName.normalize('NFC').replace(/\s+/g, ' ') }, points: row.points }));
  const roster = new Set(standings.map(r => r.team.id));
  assert(roster.size === standings.length && standings.every((s, i) => s.rank === i + 1), 'STANDINGS', 'Duplicate teams or incomplete ranking positions.');
  const games = [...matches.values()];
  const gameTeams = new Set(games.flatMap(m => [m.home.id, m.away.id]));
  assert(gameTeams.size === roster.size && [...gameTeams].every(t => roster.has(t)), 'ROSTER', 'Schedule and standings rosters differ.');
  // CBV may publish the complete first leg before publishing the return leg.
  // Every published leg must contain every unordered pairing exactly once.
  const regular = games.filter(m => /^(?:TURNO|RETURNO) - RODADA \d+$/.test(m.phase));
  const first = regular.filter(m => m.phase.startsWith('TURNO'));
  const second = regular.filter(m => m.phase.startsWith('RETURNO'));
  const completeLeg = (leg: Match[]) => leg.length === roster.size * (roster.size - 1) / 2
    && new Set(leg.map(m => [m.home.id, m.away.id].sort().join('|'))).size === leg.length;
  assert(completeLeg(first) && (second.length === 0 || completeLeg(second)), 'COVERAGE', 'Published schedule is missing or duplicated.');
  const sourceUpdatedAt = typeof tables[0]!.lastUpdated === 'string' ? tables[0]!.lastUpdated : null;
  return { competition, season, championshipId, matches: games, standings, sourceUrl, standingsUrl, sourceUpdatedAt, rounds, firstLegOnly: second.length === 0 };
}
