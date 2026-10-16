# CBV source research

Researched October 15, 2026 using public official CBV pages. These observations establish candidate sources; they do not prove a working scraper or complete historical coverage.

## Source inventory

| Source | Observed use |
| --- | --- |
| [CBV homepage](https://cbv.com.br/) | Current-season navigation, fixture previews, partial standings |
| [Men's Superliga A](https://cbv.com.br/volei-de-quadra/superliga-a-masculina) | Current competition landing page and fixture content |
| [Women's Superliga A](https://cbv.com.br/volei-de-quadra/superliga-a-feminina) | Current competition page with teams, fixture dates, and match details |
| [Women's full standings](https://cbv.com.br/volei-de-quadra/superliga-a-feminina/classificacao) | Complete ranking table with points and other statistics |
| [Women's match reports](https://cbv.com.br/volei-de-quadra/superliga-a-feminina/sumulas) | Official report section; no reports published in the inspected page |
| [Legacy schedule](https://wp.cbv.com.br/superliga/tabela) | Older WordPress route surfaced in search |
| [Legacy standings](https://wp.cbv.com.br/superliga/classificacao) | Older WordPress route surfaced in search |
| [Historical men's page](https://cbv.com.br/volei-de-quadra/2025-2026/superliga-a-masculina) | Season-specific route; not a substitute for current-season validation |

The homepage identified season 26/27 and showed abbreviated standings. The dedicated women's standings page identified 2026/27 and displayed 12 teams, with zero points before competition began. Its text attributes consolidated data to CBV's Volley Station. The proposed service still scrapes CBV pages; this attribution does not establish a public API dependency.

The women's competition page exposed short team codes in one schedule representation and full names in match cards. It also included broadcast labels. Multiple representations can cause duplicate fixtures unless the parser targets a canonical region and deduplicates records.

Do not silently fall back to WordPress or historical URLs: first prove matching season, competition, and coverage. Search-engine freshness and HTTP 200 are not sufficient evidence of current data.

## Implementation verification (October 15, 2026)

Direct HTTP retrieval confirmed that browser rendering is unnecessary. Both current competition landing pages contain the full round-grouped schedule in embedded Next.js page data: 132 matches across 22 rounds per competition. Their linked standings pages contain 12 teams each and a matching championship ID.

The verified [men's standings page](https://cbv.com.br/volei-de-quadra/superliga-a-masculina/classificacao) complements the women's source above. The parser follows the actual link from each competition page rather than assuming it exists.

Match timestamps include explicit offsets, so timezone conversion uses the instant directly. For example, `2026-10-24T23:30:00+02:00` matches the displayed Brasília 18:30 fixture and converts to Toronto 17:30. No source-timezone guess or yearless-date inference is needed.

The [historical men's competition page](https://cbv.com.br/volei-de-quadra/2025-2026/superliga-a-masculina) and its [standings](https://cbv.com.br/volei-de-quadra/2025-2026/superliga-a-masculina/classificacao) supplied real completed-match fixtures. Tests verify 147 historical matches including playoffs and a 3–1 result. These historical pages are test sources, not production fallbacks.

The adapter extracts JSON literal data from the HTML without executing scripts or calling the underlying Volley Station API. It verifies source season, competition, championship ID, roster, regular-season pair coverage, timestamps, and final scores. Full original compressed HTML and provenance are stored in `test/fixtures/cbv`.

A live dry-run succeeded for both current competitions, producing an HTML/plain-text preview without sending email. This validates current website compatibility from the development environment, not A2 network access or SMTP delivery.

## Remaining limitations

- CBV may change embedded data structure or page routes; fail-closed validation and fixtures support maintenance.
- Missing/offset-free dates, administrative results, or unpublished standings require explicit adapter extensions; the current job reports errors.
- Current full-round coverage is verified for the regular-season format. Changed formats need reviewed coverage rules.
- Access guidance and connectivity must be reviewed on the deployment host; do not bypass access restrictions.
