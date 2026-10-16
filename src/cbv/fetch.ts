import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { JobError, assert } from '../errors.js';
import { parseCompetition, standingsLink } from './parse.js';
import type { Config } from '../config.js';
import type { Snapshot, Competition } from '../types.js';

export function officialUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new JobError('SOURCE_URL', 'Invalid CBV source URL.', 'fetch'); }
  assert(url.protocol === 'https:' && url.hostname === 'cbv.com.br' && !url.username && !url.password && (!url.port || url.port === '443'), 'SOURCE_URL', 'Source must use HTTPS on cbv.com.br.');
  return url;
}
export async function fetchHtml(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  officialUrl(url);
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    let retryMs = 1000 * 2 ** attempt;
    try {
      let target = url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        officialUrl(target);
        const response = await fetcher(target, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { 'user-agent': 'SportsTracker/1.0 (personal daily Superliga digest)', accept: 'text/html' } });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === 3) throw new JobError('REDIRECT', 'CBV redirect limit exceeded.', 'fetch');
          target = new URL(location, target).href; continue;
        }
        if (response.status === 429 || response.status >= 500) {
          const after = response.headers.get('retry-after');
          if (after) retryMs = /^\d+$/.test(after) ? Number(after) * 1000 : Math.max(0, Date.parse(after) - Date.now());
          await response.body?.cancel();
          if (!Number.isFinite(retryMs) || retryMs > 60_000) throw new JobError('RATE_LIMIT', 'CBV requested a later retry; run again after recovery.', 'fetch');
          break;
        }
        if (!response.ok) { await response.body?.cancel(); throw new JobError('HTTP', `CBV returned HTTP ${response.status}.`, 'fetch'); }
        if (!response.headers.get('content-type')?.includes('text/html')) {
          await response.body?.cancel(); throw new JobError('CONTENT_TYPE', 'CBV returned non-HTML content.', 'fetch');
        }
        const chunks: Uint8Array[] = []; let size = 0;
        const reader = response.body?.getReader();
        assert(reader, 'EMPTY_PAGE', 'CBV returned no page body.');
        try {
          while (true) {
            const part = await reader.read(); if (part.done) break;
            size += part.value.length;
            if (size > 10_000_000) { await reader.cancel(); throw new JobError('PAGE_SIZE', 'CBV page exceeded the size limit.', 'fetch'); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        return Buffer.concat(chunks).toString('utf8');
      }
    } catch (error) {
      if (error instanceof JobError || signal.aborted) throw error;
      // Network errors are retried, but their messages can contain request details.
    }
    if (attempt < 2) await delay(Math.max(500, retryMs), undefined, { signal });
  }
  throw new JobError('FETCH_FAILED', 'CBV retrieval failed after three attempts.', 'fetch');
}
export async function collect(config: Config, signal: AbortSignal): Promise<Snapshot> {
  const competitions = [];
  for (const competition of ['men', 'women'] as Competition[]) {
    const url = officialUrl(config.urls[competition]).href.replace(/\/$/, '');
    const read = async (name: string, source: string) => {
      if (config.fixtureDir) return gunzipSync(await readFile(join(config.fixtureDir, `${name}.html.gz`))).toString();
      const html = await fetchHtml(source, signal);
      // Restricted diagnostics are overwritten per run; nothing is committed or emailed.
      await mkdir(join(config.outputDir, 'sources'), { recursive: true, mode: 0o700 });
      await writeFile(join(config.outputDir, 'sources', `${name}.html`), html, { mode: 0o600 });
      await delay(300, undefined, { signal });
      return html;
    };
    const games = await read(competition, url);
    const rankingUrl = standingsLink(games, url);
    const ranking = await read(`${competition}-standings`, rankingUrl);
    competitions.push(parseCompetition(games, ranking, competition, config.season, url, rankingUrl));
  }
  return { fetchedAt: new Date().toISOString(), competitions };
}
