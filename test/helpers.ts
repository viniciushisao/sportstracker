import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseCompetition, pageObjects } from '../src/cbv/parse.js';
export const fixture = (name: string) => gunzipSync(readFileSync(new URL(`fixtures/cbv/${name}.html.gz`, import.meta.url))).toString();
export const menUrl = 'https://cbv.com.br/volei-de-quadra/superliga-a-masculina';
export function competition(gender: 'men' | 'women' = 'men') {
  const url = menUrl.replace('masculina', gender === 'men' ? 'masculina' : 'feminina');
  return parseCompetition(fixture(gender), fixture(`${gender}-standings`), gender, '2026-2027', url, url + '/classificacao');
}
export function snapshot() { return { fetchedAt: '2026-10-15T20:00:00Z', competitions: [competition('men'), competition('women')] }; }
export function modifiedPage(kind: 'games' | 'standings', modify: (data: any) => void): string {
  const objects = pageObjects(fixture(kind === 'games' ? 'men' : 'men-standings'));
  const data = structuredClone(kind === 'games' ? objects.find(o => o.matchesByRound) : objects.find(o => o.championshipId && o.teams));
  modify(data);
  const stream = '1:' + JSON.stringify(data) + '\n';
  return '<h1>Superliga Masculina</h1><p>Temporada 26/27</p><script>self.__next_f.push(' + JSON.stringify([1, stream]) + ')</script>';
}
