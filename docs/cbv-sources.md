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

## Required implementation discovery

Before declaring the adapter production-ready:

1. Follow actual navigation links from both competition pages to games, standings, and reports. Record exact final URLs and redirects in adapter configuration; verify the men's standings route rather than assuming URL symmetry.
2. Inspect raw HTTP HTML to determine whether required data is present. The research browser's readable output does not establish server-rendered availability. If JavaScript is required, render the public page with a browser and parse its DOM.
3. Determine how round selectors, pagination, earlier fixtures, playoffs, and season selectors work. Fetch all pages needed for yesterday and today, including dates adjacent in the source timezone.
4. Confirm the source's timezone from a published notice or official schedule. Do not infer it solely from the website language. Store that evidence with the adapter fixture notes.
5. Verify completed-match score/status markup against an actual played match. The inspected current women's report page contained no completed reports; final-result extraction remains unverified.
6. Capture sanitized HTML fixtures for both competitions, full standings, scheduled games, completed games, empty states, and changed seasons. Record capture time, source URL, and expected records.
7. Check source access guidance and use modest request rates. Never bypass authentication or access controls; blocked access is an operational error.

Selector names, match identifiers, page completeness rules, source timezone, and final-result extraction must be settled from this inspection. This document intentionally does not invent selectors or undocumented API endpoints.
