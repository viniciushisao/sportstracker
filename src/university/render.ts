import { DateTime } from 'luxon';
import type { Config } from '../config.js';
import type { Email } from '../types.js';
import { escapeHtml } from '../email/render.js';
import { assert } from '../errors.js';
import type { UniversitySnapshot, UniversityGame } from './schedule.js';

export function reminderGames(snapshot: UniversitySnapshot, date: string): UniversityGame[] {
  const tomorrow = DateTime.fromISO(date, { zone: 'America/Toronto' }).plus({ days: 1 }).toISODate();
  const candidates = snapshot.games.filter(g => [date, tomorrow].includes(g.date) && !['cancelled', 'postponed'].includes(g.status));
  // An unknown venue must not quietly become a false "no games" day.
  for (const g of candidates) assert(g.venue !== 'Venue not announced' && !/^(?:TBD|TBA|TBC)$/i.test(g.venue), 'UNIVERSITY_VENUE', 'A home game has no confirmed location. Check the official schedule.');
  return candidates.filter(g => g.toronto).sort((a, b) => a.date.localeCompare(b.date) || (a.startsAt || 'z').localeCompare(b.startsAt || 'z') || a.sourceId.localeCompare(b.sourceId));
}
export function renderUniversity(snapshot: UniversitySnapshot, config: Config): Email | null {
  const games = reminderGames(snapshot, config.date);
  if (!games.length) return null;
  const day = DateTime.fromISO(config.date, { zone: 'America/Toronto' });
  const tomorrow = day.plus({ days: 1 }).toISODate()!;
  // A --date preview models the requested day's scheduled 4 PM send.
  const asOf = config.now.setZone('America/Toronto').toISODate() === config.date ? config.now : day.set({ hour: 16 });
  const describe = (g: UniversityGame) => {
    const start = g.startsAt ? DateTime.fromISO(g.startsAt).setZone('America/Toronto') : null;
    const time = start ? start.toFormat('h:mm a ZZZZ') : 'Time not announced';
    const status = g.status === 'finished' ? `Final${g.result ? ` — ${g.result}` : ''}` : start && start <= asOf ? 'Scheduled start has passed; check the official schedule for current status' : 'Scheduled';
    return { time, status, title: `${g.team} vs ${g.opponent} — ${g.gender === 'men' ? "Men’s" : "Women’s"} volleyball` };
  };
  const sections = [{ date: config.date, title: 'Today' }, { date: tomorrow, title: 'Tomorrow' }].map(section => ({
    ...section, games: games.filter(g => g.date === section.date),
  })).filter(section => section.games.length);
  const subject = `Toronto home volleyball — ${day.toFormat('MMMM d, yyyy')}`;
  const footer = `Home games only · All times America/Toronto · Retrieved ${snapshot.fetchedAt}\nSchedules can change. Check the official schedule before travelling.`;
  const text = [subject, 'U of T Varsity Blues and TMU Bold', ...sections.flatMap(s => ['', `${s.title} — ${s.date}`, ...s.games.flatMap(g => {
    const d = describe(g);
    return [d.title, `${d.time} · ${d.status}`, g.venue, g.address || 'Street address not provided; check the official schedule.', `Schedule: ${g.sourceUrl}`, ...(g.ticketUrl ? [`Tickets: ${g.ticketUrl}`] : []), ''];
  })]), footer].join('\n');
  const e = escapeHtml;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head><body style="margin:0;background:#f0f3f8;font-family:Arial,Helvetica,sans-serif;color:#172033"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="max-width:600px;background:white"><tr><td style="padding:24px 16px;border-top:5px solid #1557a5"><h1 style="font-size:26px">${e(subject)}</h1><p>U of T Varsity Blues and TMU Bold</p>${sections.map(s => `<h2>${e(s.title)} — ${e(s.date)}</h2>${s.games.map(g => {
    const d = describe(g);
    return `<div style="padding:16px;margin-bottom:12px;background:#f7f9fc;border:1px solid #dce3ec;border-radius:8px;overflow-wrap:anywhere"><h3 style="margin-top:0">${e(d.title)}</h3><p><strong>${e(d.time)}</strong><br>${e(d.status)}</p><p>${e(g.venue)}<br>${e(g.address || 'Street address not provided; check the official schedule.')}</p><p><a href="${e(g.sourceUrl)}">Official schedule</a>${g.ticketUrl ? ` · <a href="${e(g.ticketUrl)}">Tickets</a>` : ''}</p></div>`;
  }).join('')}`).join('')}<p style="color:#566175;font-size:13px">${e(footer).replace(/\n/g, '<br>')}</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
