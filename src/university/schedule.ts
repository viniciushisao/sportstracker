import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { assert } from '../errors.js';

export interface ScheduleSource {
  id: string; school: 'uoft' | 'tmu'; team: string; gender: 'men' | 'women'; url: string;
}
export interface UniversityGame {
  id: string; sourceId: string; team: string; gender: 'men' | 'women'; opponent: string;
  date: string; startsAt: string | null; venue: string; address: string | null;
  toronto: boolean; status: 'scheduled' | 'finished' | 'cancelled' | 'postponed';
  result: string; sourceUrl: string; ticketUrl: string | null;
}
export interface UniversitySnapshot {
  fetchedAt: string; sources: { id: string; url: string; games: number }[]; games: UniversityGame[];
}
export function scheduleSources(season: string): ScheduleSource[] {
  const short = `${season.slice(0, 4)}-${season.slice(7)}`;
  return (['uoft', 'tmu'] as const).flatMap(school => (['men', 'women'] as const).map(gender => ({
    id: `${school}-${gender}`, school, gender,
    team: school === 'uoft' ? 'U of T Varsity Blues' : 'TMU Bold',
    url: `https://${school === 'uoft' ? 'varsityblues.ca' : 'tmubold.ca'}/sports/${gender}s-volleyball/schedule/${short}?grid=true`,
  })));
}
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
// Match the published venue, never infer a gym from the home team alone.
const venues = [
  { pattern: /^(?:Toronto, (?:Ont\.|Ontario)\s*\()?Goldring Centre(?: Kimel Family Field House)?\)?$/i,
    name: 'Goldring Centre — Kimel Family Field House', address: '100 Devonshire Place, Toronto, ON' },
  { pattern: /^(?:Toronto, (?:Ont\.|Ontario)\s*\()?Mattamy Athletic Centre\)?$/i,
    name: 'Mattamy Athletic Centre — Home Court', address: '50 Carlton Street, Toronto, ON' },
];
export function parseSchedule(html: string, source: ScheduleSource, season: string): UniversityGame[] {
  const $ = load(html);
  const table = $('table').filter((_, el) => $(el).find('tr.sidearm-schedule-game').length > 0);
  assert(table.length === 1, 'UNIVERSITY_FORMAT', `Expected one schedule table for ${source.id}.`);
  const caption = clean(table.find('caption').text());
  const sport = source.gender === 'men' ? /\bMen's Volleyball|Volleyball \(M\)/i : /Women's Volleyball|Volleyball \(W\)/i;
  assert(caption.startsWith(`${season.slice(0, 4)}-${season.slice(7)} `) && sport.test(caption), 'UNIVERSITY_SEASON', `Wrong season or sport for ${source.id}.`);
  const headers = table.find('thead th').map((_, el) => clean($(el).text()).toLowerCase()).get();
  for (const name of ['date', 'time', 'at', 'opponent', 'location', 'result'])
    assert(headers.filter(h => h === name).length === 1, 'UNIVERSITY_FORMAT', `Missing or duplicate ${name} column for ${source.id}.`);
  const games: UniversityGame[] = [];
  const seen = new Set<string>();
  table.find('tr.sidearm-schedule-game').each((_, el) => {
    const row = $(el); const cells = row.children('td');
    assert(cells.length === headers.length, 'UNIVERSITY_FORMAT', `Changed table columns for ${source.id}.`);
    const cell = (name: string) => cells.eq(headers.indexOf(name));
    const at = clean(cell('at').text()).toLowerCase();
    assert(['home', 'away', 'neutral'].includes(at), 'UNIVERSITY_FORMAT', `Unknown home/away designation for ${source.id}.`);
    assert(row.hasClass(`sidearm-schedule-${at}-game`), 'UNIVERSITY_FORMAT', `Conflicting home designation for ${source.id}.`);
    if (at !== 'home') return;
    const dateText = clean(cell('date').text()).replace(/\s*\([^)]*\)$/, '');
    const day = DateTime.fromFormat(dateText, 'MMMM d, yyyy', { zone: 'America/Toronto', locale: 'en-US' });
    assert(day.isValid && [Number(season.slice(0, 4)), Number(season.slice(5))].includes(day.year), 'UNIVERSITY_DATE', `Invalid game date for ${source.id}.`);
    const timeText = clean(cell('time').text());
    const time = timeText.replace(/\./g, '').toUpperCase();
    const result = clean(cell('result').text());
    const statusText = `${timeText} ${result}`;
    const status = /cancel(?:led|ed)/i.test(statusText) ? 'cancelled' : /postponed/i.test(statusText) ? 'postponed' : /^(?:W|L|T)\s*,/i.test(result) ? 'finished' : 'scheduled';
    let startsAt: string | null = null;
    if (!/^(?:TBD|TBA|TBC|CANCELLED|CANCELED|POSTPONED)?$/i.test(time)) {
      const start = DateTime.fromFormat(`${dateText} ${time}`, 'MMMM d, yyyy h:mm a', { zone: 'America/Toronto', locale: 'en-US' });
      assert(start.isValid, 'UNIVERSITY_TIME', `Unrecognized game time for ${source.id}.`);
      startsAt = start.toISO()!;
    }
    const opponentCell = cell('opponent').clone(); opponentCell.find('div').remove();
    const opponent = clean(opponentCell.text()).replace(/^X-/, '');
    assert(opponent.length > 0, 'UNIVERSITY_FORMAT', `Missing opponent for ${source.id}.`);
    // Tournament dates and conditional playoff rounds are not confirmed fixtures.
    if (/^(?:TBD|TBA|TBC|Ontario University Athletics)$|^(?:OUA|U SPORTS)\b/i.test(opponent)) return;
    const venueText = clean(cell('location').text());
    const venue = venues.find(v => v.pattern.test(venueText));
    const toronto = !!venue || /^Toronto, (?:Ont\.|Ontario)(?:\s|$)/i.test(venueText);
    const rawTicket = row.find('.sidearm-schedule-game-links-tickets a').attr('href');
    let ticketUrl: string | null = null;
    if (rawTicket) {
      const url = new URL(rawTicket, source.url);
      if (url.protocol === 'https:' && !url.username && !url.password) ticketUrl = url.href;
    }
    const date = day.toISODate()!;
    const id = createHash('sha256').update(JSON.stringify([source.id, date, opponent, startsAt])).digest('hex');
    assert(!seen.has(id), 'UNIVERSITY_DUPLICATE', `Duplicate home game for ${source.id}.`); seen.add(id);
    games.push({ id, sourceId: source.id, team: source.team, gender: source.gender, opponent, date, startsAt,
      venue: venue?.name || venueText || 'Venue not announced', address: venue?.address || null,
      toronto, status, result, sourceUrl: source.url, ticketUrl });
  });
  return games;
}
