import { DateTime } from 'luxon';
import { assert } from '../errors.js';
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
  for (const competition of snapshot.competitions) {
    if (competition.firstLegOnly) {
      const lastDate = competition.matches.map(m => DateTime.fromISO(m.startsAt).setZone(config.timezone).toISODate()!).sort().at(-1)!;
      assert(config.date <= lastDate, 'COVERAGE', 'Digest date is beyond the published first-leg schedule.');
    }
  }
  const yesterday = date.minus({ days: 1 }).toISODate()!;
  const today = dayMatches(snapshot, config.date, config.timezone);
  const previous = dayMatches(snapshot, yesterday, config.timezone);
  const roundLabel = (m: Match): string => {
    const round = /^(TURNO|RETURNO) - RODADA (\d+)$/.exec(m.phase);
    if (!round) return m.phase;
    const perLeg = snapshot.competitions.find(c => c.competition === m.competition)!.standings.length - 1;
    return `Round ${Number(round[2]) + (round[1] === 'RETURNO' ? perLeg : 0)}/${perLeg * 2}`;
  };
  const broadcastLabel = (m: Match) => m.broadcasters.length ? m.broadcasters.join(', ') : 'Not announced';
  const matchTime = (m: Match) => {
    const brt = DateTime.fromISO(m.startsAt).setZone('UTC-3').setLocale('en-US');
    const day = brt.toISODate() === config.date ? '' : `${brt.toFormat('MMM d')} · `;
    return `${day}${brt.toFormat('h:mm a')} BRT (UTC−3)`;
  };
  const line = (m: Match, previousDay = false): string => {
    const label = m.competition === 'men' ? 'Men' : 'Women';
    const score = m.homeSets === null ? ' × ' : ` ${m.homeSets} × ${m.awaySets} `;
    const time = matchTime(m);
    const status = m.status === 'postponed' ? ' — Postponed' : m.status === 'live' ? ' — Live' : m.status === 'finished' ? ' — Final' : previousDay ? ' — Result pending' : '';
    return `${previousDay ? '' : time + ' — '}${m.home.name}${score}${m.away.name} (${label})${previousDay ? '' : ` — ${roundLabel(m)}`}${status}${previousDay ? '' : ` — Watch: ${broadcastLabel(m)}`}`;
  };
  const sections: { title: string; lines: string[] }[] = [
    { title: "Today's games", lines: today.length ? today.map(m => line(m)) : ['No games scheduled today.'] },
    { title: 'Yesterday', lines: previous.length ? previous.map(m => line(m, true)) : ['No games yesterday.'] },
    ...(['men', 'women'] as const).map(gender => ({ title: gender === 'men' ? "Men's standings" : "Women's standings", lines: snapshot.competitions.find(c => c.competition === gender)!.standings.map(s => `${s.rank}. ${s.team.name} — T ${s.played} · W ${s.wins} · L ${s.losses} · P ${s.points}`) })),
  ];
  const title = `Superliga — ${date.toFormat('MMM d')}`;
  const subtitle = `${config.fixtureDir ? 'Offline fixture preview · ' : ''}Season ${config.season} · Game times: Brasília / BRT (UTC−3) · Digest day: ${config.timezone}`;
  const footer = [...snapshot.competitions.filter(c => c.firstLegOnly).map(c => `${c.competition === 'men' ? 'Men' : 'Women'}: CBV has published the first-leg schedule only; return-leg fixtures are not yet available.`), `Retrieved ${DateTime.fromISO(snapshot.fetchedAt).setZone(config.timezone).toFormat('yyyy-MM-dd h:mm a')} (${config.timezone}).`, 'Standings follow CBV’s published table; during playoffs this may remain the regular-season ranking.', ...snapshot.competitions.flatMap(c => [c.sourceUrl, c.standingsUrl, ...(c.sourceUpdatedAt ? [`${c.competition === 'men' ? 'Men' : 'Women'} source update: ${c.sourceUpdatedAt}`] : [])])];
  const text = [title, subtitle, ...sections.flatMap(s => ['', s.title, ...s.lines]), '', ...footer].join('\n');
  const heading = (label: string) => `<h2 style="margin:28px 0 12px;font-size:20px;line-height:1.3;color:#172033">${escapeHtml(label)}</h2>`;
  const matchesHtml = (matches: Match[], previousDay = false) => matches.length ? matches.map(m => {
    const time = matchTime(m);
    const status = m.status === 'postponed' ? 'Postponed' : m.status === 'live' ? 'Live' : m.status === 'finished' ? 'Final' : previousDay ? 'Result pending' : 'Scheduled';
    const teamRow = (name: string, score: number | null) => `<tr><td style="padding:5px 0;font-size:16px;line-height:1.5;overflow-wrap:anywhere;word-wrap:break-word">${escapeHtml(name)}</td><td width="32" align="right" style="width:32px;padding:5px 0 5px 8px;font-size:20px;font-weight:bold;vertical-align:top">${score ?? '–'}</td></tr>`;
    return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;margin:0 0 12px;border:1px solid #dce3ec;border-radius:12px;background:#f7f9fc"><tr><td style="padding:14px 16px"><p style="margin:0 0 8px;color:#44546c;font-size:13px;line-height:1.5">${m.competition === 'men' ? 'Men' : 'Women'} · ${previousDay ? '' : `${escapeHtml(time)} · ${escapeHtml(roundLabel(m))} · `}${status}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed">${teamRow(m.home.name, m.homeSets)}${teamRow(m.away.name, m.awaySets)}</table>${previousDay ? '' : `<p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:#44546c;overflow-wrap:anywhere;word-wrap:break-word"><strong>Watch:</strong> ${escapeHtml(broadcastLabel(m))}</p>`}</td></tr></table>`;
  }).join('') : `<p style="margin:0;font-size:16px;line-height:1.6;color:#566175">${previousDay ? 'No games yesterday.' : 'No games scheduled today.'}</p>`;
  const standingsHtml = (gender: 'men' | 'women') => {
    const standings = snapshot.competitions.find(c => c.competition === gender)!.standings;
    return `${heading(gender === 'men' ? "Men's standings" : "Women's standings")}<table width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:15px;line-height:1.5"><thead><tr><th scope="col" width="24" style="width:24px;text-align:left;padding:8px 0;color:#566175;font-size:12px">#</th><th scope="col" style="text-align:left;padding:8px 4px;color:#566175;font-size:12px">Team</th>${['T', 'W', 'L', 'P'].map(label => `<th scope="col" width="28" style="width:28px;text-align:right;padding:8px 0;color:#566175;font-size:12px">${label}</th>`).join('')}</tr></thead><tbody>${standings.map(s => `<tr><td style="padding:11px 0;border-top:1px solid #e5eaf0;vertical-align:top;color:#566175">${s.rank}</td><th scope="row" style="padding:11px 4px;border-top:1px solid #e5eaf0;text-align:left;font-weight:normal;overflow-wrap:anywhere;word-wrap:break-word">${escapeHtml(s.team.name)}</th>${[s.played, s.wins, s.losses, s.points].map((value, i) => `<td style="padding:11px 0;border-top:1px solid #e5eaf0;text-align:right;vertical-align:top;font-weight:${i === 3 ? 'bold' : 'normal'}">${value}</td>`).join('')}</tr>`).join('')}</tbody></table><p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:#566175">T: Total games · W: Won · L: Lost · P: Points</p>`;
  };
  const sourcesHtml = snapshot.competitions.map(c => {
    const label = c.competition === 'men' ? 'Men' : 'Women';
    return `<p style="margin:8px 0;line-height:2"><a href="${escapeHtml(c.sourceUrl)}" style="color:#1557a5">${label}: schedule</a> · <a href="${escapeHtml(c.standingsUrl)}" style="color:#1557a5">standings</a></p>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;width:100%;background:#f0f3f8;color:#172033;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;background:#f0f3f8"><tr><td align="center"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;table-layout:fixed;background:#ffffff"><tr><td style="padding:24px 16px;border-top:5px solid #1557a5"><p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:2px;color:#1557a5">DAILY VOLLEYBALL</p><h1 style="margin:0 0 10px;font-size:28px;line-height:1.2">${escapeHtml(title)}</h1><p style="margin:0;font-size:14px;line-height:1.6;color:#566175;overflow-wrap:anywhere">${escapeHtml(subtitle)}</p>${heading("Today's games")}${matchesHtml(today)}${heading('Yesterday')}${matchesHtml(previous, true)}${standingsHtml('men')}${standingsHtml('women')}<div style="border-top:1px solid #dce3ec;margin-top:28px;padding-top:16px;font-size:13px;line-height:1.6;color:#566175;overflow-wrap:anywhere;word-wrap:break-word">${footer.filter(l => !l.startsWith('https://')).map(l => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join('')}${sourcesHtml}</div></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  return { subject: `Superliga — ${date.toFormat('MMMM d, yyyy')}`, html, text };
}
