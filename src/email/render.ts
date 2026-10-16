import { DateTime } from 'luxon';
import type { Email, Match, Snapshot } from '../types.js';
import type { Config } from '../config.js';
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
export function dayMatches(snapshot: Snapshot, date: string, timezone: string): Match[] {
  return snapshot.competitions.flatMap(c => c.matches)
    .filter(m => DateTime.fromISO(m.startsAt).setZone(timezone).toISODate() === date)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.competition.localeCompare(b.competition) || a.id.localeCompare(b.id));
}
export function render(snapshot: Snapshot, config: Pick<Config, 'date' | 'timezone' | 'season' | 'fixtureDir'>): Email {
  const date = DateTime.fromISO(config.date, { zone: config.timezone }).setLocale('en-CA');
  const yesterday = date.minus({ days: 1 }).toISODate()!;
  const today = dayMatches(snapshot, config.date, config.timezone);
  const previous = dayMatches(snapshot, yesterday, config.timezone);
  const line = (m: Match, previousDay = false): string => {
    const label = m.competition === 'men' ? 'Men' : 'Women';
    const score = m.homeSets === null ? ' × ' : ` ${m.homeSets} × ${m.awaySets} `;
    const time = DateTime.fromISO(m.startsAt).setZone(config.timezone).setLocale('en-US').toFormat('h:mm a');
    const status = m.status === 'postponed' ? ' — Postponed' : m.status === 'live' ? ' — Live' : m.status === 'finished' ? ' — Final' : previousDay ? ' — Result pending' : '';
    return `${previousDay ? '' : time + ' — '}${m.home.name}${score}${m.away.name} (${label})${status}`;
  };
  const sections: { title: string; lines: string[] }[] = [
    { title: "Today's games", lines: today.length ? today.map(m => line(m)) : ['No games scheduled today.'] },
    { title: 'Yesterday', lines: previous.length ? previous.map(m => line(m, true)) : ['No games yesterday.'] },
    ...(['men', 'women'] as const).map(gender => ({ title: gender === 'men' ? "Men's standings" : "Women's standings", lines: snapshot.competitions.find(c => c.competition === gender)!.standings.map(s => `${s.rank}. ${s.team.name} — ${s.points} pts`) })),
  ];
  const title = `Superliga — ${date.toFormat('MMM d')}`;
  const subtitle = `${config.fixtureDir ? 'Offline fixture preview · ' : ''}Season ${config.season} · All times: ${config.timezone}`;
  const footer = [`Retrieved ${DateTime.fromISO(snapshot.fetchedAt).setZone(config.timezone).toFormat('yyyy-MM-dd h:mm a')} (${config.timezone}).`, 'Standings follow CBV’s published table; during playoffs this may remain the regular-season ranking.', ...snapshot.competitions.flatMap(c => [c.sourceUrl, c.standingsUrl, ...(c.sourceUpdatedAt ? [`${c.competition === 'men' ? 'Men' : 'Women'} source update: ${c.sourceUpdatedAt}`] : [])])];
  const text = [title, subtitle, ...sections.flatMap(s => ['', s.title, ...s.lines]), '', ...footer].join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f5f6f8;color:#172033;font-family:Arial,sans-serif"><main style="max-width:640px;margin:0 auto;padding:28px 20px;background:#ffffff"><h1 style="font-size:28px">${escapeHtml(title)}</h1><p style="color:#566175;font-size:13px">${escapeHtml(subtitle)}</p>${sections.map(s => `<section style="margin-top:30px"><h2 style="font-size:21px">${escapeHtml(s.title)}</h2>${s.lines.map(l => `<p style="font-size:16px;line-height:1.6;overflow-wrap:anywhere;margin:9px 0">${escapeHtml(l)}</p>`).join('')}</section>`).join('')}<footer style="border-top:1px solid #ddd;margin-top:32px;padding-top:16px;font-size:12px;color:#566175">${footer.map(l => l.startsWith('https://') ? `<p><a href="${escapeHtml(l)}">${escapeHtml(l)}</a></p>` : `<p>${escapeHtml(l)}</p>`).join('')}</footer></main></body></html>`;
  return { subject: `Superliga — ${date.toFormat('MMMM d, yyyy')}`, html, text };
}
