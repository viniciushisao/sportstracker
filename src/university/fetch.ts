import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fetchHtml } from '../cbv/fetch.js';
import type { Config } from '../config.js';
import { assert } from '../errors.js';
import { parseSchedule, scheduleSources, type UniversitySnapshot } from './schedule.js';
export function universityUrl(value: string): URL {
  const url = new URL(value);
  assert(url.protocol === 'https:' && ['varsityblues.ca', 'tmubold.ca'].includes(url.hostname) && !url.username && !url.password && (!url.port || url.port === '443'), 'SOURCE_URL', 'University sources must use HTTPS on the official athletics websites.');
  return url;
}
export async function collectUniversity(config: Config, signal: AbortSignal): Promise<UniversitySnapshot> {
  const snapshot: UniversitySnapshot = { fetchedAt: new Date().toISOString(), sources: [], games: [] };
  for (const source of scheduleSources(config.universitySeason)) {
    signal.throwIfAborted();
    const html = config.fixtureDir
      ? gunzipSync(await readFile(join(config.fixtureDir, `${source.id}.html.gz`))).toString()
      : await fetchHtml(source.url, signal, fetch, universityUrl);
    if (!config.fixtureDir) {
      await mkdir(join(config.outputDir, 'sources'), { recursive: true, mode: 0o700 });
      await writeFile(join(config.outputDir, 'sources', `${source.id}.html`), html, { mode: 0o600 });
    }
    const games = parseSchedule(html, source, config.universitySeason);
    snapshot.sources.push({ id: source.id, url: source.url, games: games.length });
    snapshot.games.push(...games);
  }
  return snapshot;
}
