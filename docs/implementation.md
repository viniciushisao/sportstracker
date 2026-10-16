# Implementation details

Implemented in TypeScript with strict checking. Node.js 24 LTS is the production recommendation. Node.js 22.12 is the minimum tested runtime; scripts pass `--experimental-sqlite` for its built-in SQLite module. This avoids native SQLite package compilation on shared hosting. The account must supply a Node build with SQLite enabled.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/main.ts` | Environment loading, CLI entry point, hard ten-minute deadline |
| `src/config.ts` | Validated configuration, explicit send/dry-run flags, Toronto scheduling gate |
| `src/job.ts` | Lock, fetch, render, delivery orchestration, error reporting |
| `src/cbv/fetch.ts` | Restricted official-host HTTP retrieval, retries, fixture loading |
| `src/cbv/parse.ts` | CBV HTML hydration parsing, source identities, normalization, completeness checks |
| `src/types.ts` | Normalized match, standing, snapshot, and email contracts |
| `src/email/render.ts` | Toronto-day selection, English HTML and plain text |
| `src/email/transport.ts` | TLS SMTP submission and conservative outcome classification |
| `src/email/config-error.ts` | Startup error notification with independently validated mail settings |
| `src/state.ts` | SQLite run/snapshot/delivery history and filesystem process lock |
| `src/errors.ts` | Safe operational error categories |
| `scripts/run-daily.sh` | Compiled-job launcher with explicit working directory and Node path support |

Dependencies and exact resolved versions are in `package-lock.json`. Cheerio parses HTML, Luxon handles dates/timezones, Zod validates source records, Nodemailer submits mail, and dotenv reads private configuration. No browser engine or sports data API is required.

## Website adapter

The current CBV pages expose full `matchesByRound` data in their Next.js hydration scripts. The parser reads only JSON literal arguments of `self.__next_f.push`, concatenates text chunks, and walks JSON records. It never evaluates website JavaScript. Data transport details remain an adapter dependency that may change when CBV updates its website.

For each competition, retrieve the configured landing page and follow its actual current standings link. The full standings data contains `championshipId`, `teams`, and `lastUpdated`. The adapter validates the visible competition/season labels and joins schedule and standings by championship ID. It does not use homepage previews, legacy WordPress pages, or a different season as a silent fallback.

Match and team identities are namespaced by competition and season. CBV's stable numeric IDs form their suffixes; changing kickoff time does not change identity. Official names retain accents, with whitespace normalized. Scores and points remain source values.

Coverage checks require:

- Exactly one full round-grouped schedule and the matching standings table.
- All required match fields, explicit timestamp offsets, unique consistent match records, and valid completed scores.
- Unique standings teams, contiguous official ranking positions, and valid numeric points (including preseason zeroes).
- Identical team sets in schedule and standings.
- Every unordered pairing once in TURNO and once in RETURNO, for `n × (n − 1)` regular-season matches. Team count is derived from the source, not a permanently hardcoded 12.

Some published return fixtures retain the same home/away order as their first fixture. Coverage therefore checks unordered pairs within each phase rather than requiring reversed home/away assignments. Playoff fixtures present in the full schedule are retained in addition to the regular season. Published standings order is preserved; the email notes that this may remain a regular-season table during playoffs.

## Time and status handling

CBV's embedded `MatchDateTime` values contain explicit offsets. Parse the complete instant and convert it to UTC, then select/display it in `America/Toronto`. For example, `2026-10-24T23:30:00+02:00` is `21:30Z` and `5:30 PM` Toronto time. Do not assume the source timestamp's wall clock is Brazilian local time.

Capture the run time once to determine the digest date. Yesterday is the preceding Toronto calendar date, not a fixed 24-hour subtraction. Include all of today's matches, even completed matches earlier than 16:00. Yesterday's unfinished matches remain visible as `Result pending`. Explicit live and postponed flags are preserved. Finished scores require three sets for the winner and zero to two for the other side.

Current adapter limitations deliberately fail closed:

- Missing/date-only/offset-free timestamps fail validation. The initial proposed `Time TBD` fallback is not enabled because the inspected source does not establish a reliable unknown-time representation.
- Administrative/disqualification outcomes fail validation pending explicit interpretation.
- Empty/unpublished standings fail validation rather than being treated as an empty league. No verified explicit unpublished-state adapter exists yet.
- An entirely removed cancelled fixture cannot be reconstructed from the current page. There is no cancellation-change history or late-result catch-up email.
- A future competition format without the current complete TURNO/RETURNO schedule needs a reviewed adapter update.

These failures produce an error notification instead of an incomplete normal digest. The service reflects CBV's current published data; it cannot independently confirm the correctness of provisional dates or delayed scores.

## HTTP policy

Only HTTPS on `cbv.com.br` is allowed, including redirect targets. Requests use a descriptive user agent, manual redirect validation, a 20-second request timeout, at most three redirects, and a 10 MB body cap. Non-HTML content and permanent HTTP failures are not retried. Network failures, HTTP 429, and 5xx responses get at most three attempts. Retry-After is honored up to 60 seconds; longer delays fail for operator retry. Successful requests are separated by 300 ms.

The job reserves 30 seconds of its ten-minute limit for failure reporting. The CLI's hard timeout terminates a hung process and leaves conservative recovery state. Diagnostic HTML is saved with restricted permissions under `output/sources` and overwritten on each run. No raw source content or secrets are emailed or logged.

## Delivery and recovery

The daily digest key is `(recipient, Toronto date, timezone, digest)`. Production runs acquire a filesystem lock before opening SQLite. An active lock results in a logged successful skip. A lock older than eleven minutes causes an error notification and requires operator review; it is never automatically removed.

SQLite stores runs, normalized snapshots, and delivery attempts. Each attempt has a unique Message-ID, content hash, timestamp, and optional operator override reason. A transactional partial unique index prevents more than one unresolved attempt for a digest key.

State progression:

```text
prepared → sending → accepted
                   → rejected
                   → unknown
unresolved attempt → superseded (explicit audited operator override only)
```

An accepted digest skips later ordinary runs for that day. `prepared`, `sending`, and `unknown` block automatic resends. Explicit SMTP rejection is distinct from a lost connection after possible acceptance. Only definite transient rejection or pre-submission connection failure is retried, at most three times. A lost DATA reply is never retried automatically.

SMTP and SQLite cannot form one atomic transaction. A crash after provider acceptance but before state recording leaves an unresolved attempt. Inspect provider records by Message-ID before using `--resend-reason`. Message-ID does not guarantee provider deduplication. SMTP acceptance also does not guarantee inbox placement.

Error handling uses an independent plain-text renderer and one notification attempt per failed invocation (with bounded transport retries). Source, validation, state, and rendering failures prevent normal delivery. Startup configuration errors can be reported only if independently validated mail settings are available. Error-email failures are logged and never recurse. A dead server, invalid mail configuration, or provider outage may prevent notifications.

## Commands and tests

- `npm run check`: TypeScript checking and offline tests.
- `npm run build`: compile to `dist`.
- `npm run preview`: offline official-fixture preview for October 26, 2026.
- `npm run daily -- --dry-run`: live retrieval and preview; never sends email or mutates delivery state.
- `npm run daily -- --send`: explicit production delivery.
- `scripts/run-daily.sh --scheduled`: compiled production job, due only at 16:00 Toronto; sending still depends on `DRY_RUN=false`.
- `--date YYYY-MM-DD`: explicit manual digest date using the configured published season.
- `--resend-reason "Provider confirmed no delivery"`: explicit audited resend after reconciliation; cannot be used with `--scheduled`.

Tests use original compressed official HTML for both current competitions and historical men's results, plus clearly synthetic mutations. They cover full schedules, scores, changed/missing markup, duplicate records, season mismatch, timezone offsets, DST and year boundaries, rendering escape rules, empty days, persistent duplicate suppression, concurrent invocations, stale locks, ambiguous SMTP delivery, and error notifications. SMTP behavior is mocked; real provider and inbox verification remains a deployment step.
