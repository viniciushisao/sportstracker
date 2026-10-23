import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { assert, JobError } from './errors.js';
import { parseCompetition } from './cbv/parse.js';
import { parseSchedule, scheduleSources } from './university/schedule.js';

// Available in both src/ and compiled dist/; deploy test/fixtures with the app.
const fixtureRoot = new URL('../test/fixtures/', import.meta.url);
async function fixture(path: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return gunzipSync(await readFile(new URL(path, fixtureRoot), { signal })).toString();
}
async function checked(label: string, signal: AbortSignal, run: () => Promise<void>) {
  try { await run(); signal.throwIfAborted(); }
  catch { throw new JobError('PARSER_HEALTH', `${label} saved-example parser checks failed or fixtures are unavailable. No all-clear can be issued.`, 'parser_health'); }
}
export function checkSuperligaParser(signal: AbortSignal): Promise<void> {
  return checked('Superliga', signal, async () => {
    for (const gender of ['men', 'women'] as const) {
      const url = `https://cbv.com.br/volei-de-quadra/superliga-a-${gender === 'men' ? 'masculina' : 'feminina'}`;
      const html = await fixture(`cbv/${gender}.html.gz`, signal);
      const standings = await fixture(`cbv/${gender}-standings.html.gz`, signal);
      const parsed = parseCompetition(html, standings, gender, '2026-2027', url, url + '/classificacao');
      assert(parsed.matches.length === 132 && parsed.standings.length === 12, 'PARSER_HEALTH', 'Saved Superliga counts changed.');
      let rejected = false;
      try { parseCompetition('<html>Invalid schedule</html>', standings, gender, '2026-2027', url, url); } catch { rejected = true; }
      assert(rejected, 'PARSER_HEALTH', 'Invalid Superliga schedule was accepted.');
    }
  });
}
export function checkUniversityParser(signal: AbortSignal): Promise<void> {
  return checked('University volleyball', signal, async () => {
    const counts = [12, 15, 16, 13];
    for (const [index, source] of scheduleSources('2026-2027').entries()) {
      const parsed = parseSchedule(await fixture(`university/${source.id}.html.gz`, signal), source, '2026-2027');
      assert(parsed.length === counts[index] && parsed.every(g => g.toronto && g.address), 'PARSER_HEALTH', 'Saved university home-game expectations changed.');
      assert(!parsed.some(g => g.sourceId === 'uoft-men' && g.date === '2026-09-19'), 'PARSER_HEALTH', 'An away game was included.');
      let rejected = false;
      try { parseSchedule('<html>Invalid schedule</html>', source, '2026-2027'); } catch { rejected = true; }
      assert(rejected, 'PARSER_HEALTH', 'Invalid university schedule was accepted.');
    }
  });
}
