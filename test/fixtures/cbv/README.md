# Official HTML fixtures

Captured from public CBV pages on October 15, 2026. Files are gzip-compressed original HTML, not API responses. Tests parse the website's embedded JSON literals without executing scripts. Public player/club metadata in the original HTML is unused by the application.

| File | URL |
| --- | --- |
| men.html.gz | https://cbv.com.br/volei-de-quadra/superliga-a-masculina |
| women.html.gz | https://cbv.com.br/volei-de-quadra/superliga-a-feminina |
| men-standings.html.gz | https://cbv.com.br/volei-de-quadra/superliga-a-masculina/classificacao |
| women-standings.html.gz | https://cbv.com.br/volei-de-quadra/superliga-a-feminina/classificacao |
| history.html.gz | https://cbv.com.br/volei-de-quadra/2025-2026/superliga-a-masculina |
| history-standings.html.gz | https://cbv.com.br/volei-de-quadra/2025-2026/superliga-a-masculina/classificacao |

Current-season expected coverage: 132 distinct scheduled matches, 22 rounds, and 12 standings rows per competition. Historical men's coverage: 147 matches including completed games and playoffs; first match Sada Cruzeiro 3–1 JFVôlei, October 21, 2025.

The match timestamps carry explicit offsets, e.g. `2026-10-24T23:30:00+02:00`, which is `21:30Z`, `18:30` in Brasília and `17:30` in Toronto. Do not treat the timestamp's wall clock as Brazilian local time or apply a guessed fixed offset. The full HTML schedule includes each unordered pairing once per TURNO/RETURNO; some published return fixtures retain the same home/away order, so validation must not require reversed home/away assignments.

Mutation tests derive malformed/truncated/status variants from these fixtures. Those mutations are synthetic tests, not additional official observations. Refresh fixtures intentionally and review changes in IDs, seasons, schema, and counts before updating expectations.
