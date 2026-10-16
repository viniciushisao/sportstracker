import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHtml, officialUrl } from '../src/cbv/fetch.js';
test('only official HTTPS source hosts are accepted', () => {
  for (const url of ['http://cbv.com.br', 'https://cbv.com.br.evil.test', 'https://user:pass@cbv.com.br', 'https://cbv.com.br:8443']) assert.throws(() => officialUrl(url));
});
test('redirects cannot escape official host', async () => {
  await assert.rejects(fetchHtml('https://cbv.com.br', new AbortController().signal, (async () => new Response(null, { status: 302, headers: {location:'https://example.org'} })) as typeof fetch), /cbv.com.br/);
});
test('access denial is not retried', async () => {
  let count = 0;
  await assert.rejects(fetchHtml('https://cbv.com.br', new AbortController().signal, (async () => { count++; return new Response('', {status:403}); }) as typeof fetch), /403/);
  assert.equal(count, 1);
});
test('HTTP 200 challenge page with wrong content type is rejected', async () => {
  await assert.rejects(fetchHtml('https://cbv.com.br', new AbortController().signal, (async () => new Response('{}', {headers:{'content-type':'application/json'}})) as typeof fetch), /non-HTML/);
});
test('retry-after exceeding run budget fails rather than hammering source', async () => {
  await assert.rejects(fetchHtml('https://cbv.com.br', new AbortController().signal, (async () => new Response('', {status:429,headers:{'retry-after':'3600'}})) as typeof fetch), /later retry/);
});
