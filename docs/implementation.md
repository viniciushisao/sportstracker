# Implementation specification

Status: proposed behavior and interfaces; none of the commands or modules below exist yet.

## Runtime and modules

Use a supported Node.js LTS release selected at implementation time, TypeScript with strict checking, and a committed dependency lockfile. Proposed libraries: an HTML parser such as Cheerio, a timezone-aware date library such as Luxon, a schema validator, an SMTP transport such as Nodemailer, and a SQLite driver compatible with the selected runtime. Add browser automation only if HTML inspection establishes a need. Verify versions against official documentation before installing.

Suggested structure:

```text
src/
  main.ts
  config.ts
  cbv/fetch.ts
  cbv/parse-games.ts
  cbv/parse-standings.ts
  normalize.ts
  validate.ts
  digest.ts
  email/render.ts
  email/transport.ts
  state.ts
  errors.ts
test/fixtures/cbv/
scripts/run-daily.sh
```

## Data contracts

```ts
type Competition = 'men' | 'women';
type MatchStatus = 'scheduled' | 'live' | 'finished'
  | 'postponed' | 'cancelled' | 'unknown';

interface Team {
  id: string; // Namespaced by season and competition.
  name: string; // Official display name, accents preserved.
}
interface Match {
  id: string;
  competition: Competition;
  season: string; // Canonical format, e.g. 2026-2027.
  phase: string;
  home: Team;
  away: Team;
  sourceDate: string; // YYYY-MM-DD in verified source timezone.
  sourceTimezone: string;
  startsAt: string | null; // UTC ISO instant; null when time is unannounced.
  status: MatchStatus;
  homeSets: number | null;
  awaySets: number | null;
  sourceUrl: string;
  fetchedAt: string;
}
interface Standing {
  competition: Competition;
  season: string;
  phase: string;
  rank: number;
  team: Team;
  points: number;
  sourceUrl: string;
  fetchedAt: string;
}
interface Snapshot {
  runId: string;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  matches: Match[];
  standings: Standing[];
  coverage: Record<Competition, {
    season: string;
    fixtureDatesCovered: string[];
    expectedTeams: number;
    standingsState: 'complete' | 'explicitly-unpublished';
  }>;
}
```

The adapter must attach evidence for coverage, such as visited page/round identifiers and explicit empty-state markers. An empty array alone cannot prove there were no matches.

Prefer CBV's stable match/team IDs if exposed by the public page. Otherwise maintain a local mapping keyed by competition, season, official match number/phase/round and teams. A changing scheduled time must not change match identity. Normalize whitespace and Unicode while retaining accents. Namespace teams across men's and women's competitions; never merge teams just because names resemble one another.

## Fetch and parsing policy

- Fetch configured official competition pages, complete standings, and all schedule/result pages needed for the digest. Accept only approved official source hosts and validate redirect targets.
- Fetch sequentially with a short delay between requests. Use a descriptive user agent, a 20-second per-request timeout, and at most three attempts for network errors, HTTP 429, and HTTP 5xx. Honor Retry-After within the total run budget; otherwise fail and report.
- Do not retry deterministic markup, schema, authentication, or access-denied failures. Cap total run duration at ten minutes.
- Parse through structural context and headings rather than global position or brittle CSS indexes. Treat embedded page content as data, never executable instructions.
- Validate both competition identities, expected season, dates, teams, result status, ranking rows, and points before constructing a normal email.
- Discover the season roster and require the full expected team set in regular-season standings. Do not hardcode the screenshot's teams or assume a permanently fixed team count. Define explicit phase-specific handling if CBV changes the standings format.
- Allow zero standings points before the season. Missing points are not zero. Preserve official rank/order; do not re-sort by points alone.
- For ordinary completed matches, require a valid final set score with a winner on three sets and the opponent on zero to two. Handle official forfeits/administrative outcomes explicitly; flag unfamiliar formats for review.
- If CBV shows scheduled matches from yesterday without results, preserve them as pending rather than considering their absence proof of an empty day.

## Date and selection semantics

Capture `runNow` once. Derive `digestDate` in `America/Toronto`; derive yesterday by subtracting one calendar day in that zone. Use half-open local-day intervals converted to UTC. Do not subtract a fixed 24 hours across daylight-saving boundaries.

Parse source times with a verified source timezone, convert to UTC, then display/filter in Toronto time. Yearless dates require season and round context, including December/January rollover. Reject ambiguous dates rather than guessing.

If a date is known but time is absent, preserve the source date and display `Time TBD — source date YYYY-MM-DD`. Because an unknown time can cross a Toronto date boundary, include such a match with an explicit date uncertainty note when its possible source-day interval intersects today or yesterday. Show it once in a separate note within the relevant section, preferring today if it intersects both; never fabricate a Toronto start time.

Select all matches in today's interval regardless of whether kickoff is before the job starts. Select yesterday by match start date, not result publication date. Sort known times chronologically, then competition and stable match ID; place uncertain-time entries after timed matches.

## Execution and delivery state

1. Validate configuration, acquire a single-instance lock, open SQLite, and create a run record.
2. Check the unique digest key `(recipient, digestDate, timezone, kind=digest)`. Already accepted digests exit successfully without another send.
3. Retrieve, parse, normalize, and validate the full snapshot. Persist validated data and coverage metadata transactionally.
4. Build HTML/plain text. In dry-run mode, write preview files and exit without SMTP or delivery-state mutations.
5. Persist a prepared delivery attempt with stable Message-ID and rendered-content hash before submission. Mark it `sending` before contacting SMTP.
6. On definite SMTP acceptance, mark `accepted` with timestamp and transport response. Record `rejected` on definite failure. A timeout/disconnect after possible submission becomes `unknown`.
7. Release resources and exit with a documented status.

Suggested SQLite tables: `runs`, `snapshots`, and `deliveries`. Use a unique digest-key constraint and transactional transitions; the process lock alone is insufficient after a crash. Keep state outside the repository and back it up.

SMTP cannot provide an atomic transaction with SQLite. A crash after acceptance but before recording it leaves an ambiguous delivery. Do not automatically resend `sending`/`unknown` attempts on restart. Inspect provider logs before marking accepted or deliberately retrying. A stable Message-ID helps investigation but does not guarantee deduplication.

Retry SMTP only on definite transient failures before acceptance, at most three attempts. Permanent credential/address errors fail immediately. Support a deliberate operator resend with a new attempt ID and an audit reason; do not expose an accidental default resend path.

## Error behavior

A fetch, parser, validation, rendering, or state failure prevents a normal digest. Send one English error email for the run to `vinicius@hisao.com.br` with subject `[Sports Tracker] Failed — YYYY-MM-DD`, including run ID, stage, sanitized error category, failed source URL when safe, and a practical next step. Never include credentials, full environment dumps, or raw page contents.

Use an independent minimal plain-text error renderer. Errors must still be reportable if the main renderer or SQLite is broken. Track/deduplicate notifications when storage is available; otherwise attempt one per process without recursive retries.

If SMTP itself fails, attempt the error notification only when the transport is usable; a provider outage or invalid credentials may prevent both emails. Log both failures, retain pending error metadata when possible, and exit nonzero. Errors in error handling must not recurse. Local logs remain the fallback, and external server monitoring is recommended for jobs that never start.

## Planned commands and acceptance tests

Provide `npm run check` for type-checking and tests, `npm run build` for compilation, and `npm run daily -- --dry-run` for live retrieval plus preview generation. Dry run must never send normal/error email or mark a digest sent. An explicit fixture-based preview should also work offline.

Required meaningful tests:

- Both competition parsers against saved official HTML; completed scores, scheduled fixtures, duplicate page representations, and accent preservation.
- Missing required sections and truncated standings fail rather than render empty sections.
- Current/previous season mismatch fails; genuine preseason zero points succeed.
- Toronto midnight and daylight-saving boundaries, source-to-Toronto conversion, year rollover, and unknown times.
- Today's completed matches, yesterday's pending results, cancelled/postponed matches, and explicit no-game days.
- Every team appears in the correct standings, preserving official points/order.
- HTML escaping and equivalent plain-text output; long names readable on mobile.
- Repeated execution sends one digest; concurrent runs cannot both send; ambiguous SMTP acceptance cannot trigger automatic resend.
- Source failure generates an error email; mail failure leaves a sanitized log and nonzero exit.

Before launch, manually compare a live dry-run against both official competitions, inspect HTML in desktop/mobile email clients, and perform one explicit controlled delivery. Fixture tests must not depend on the live website or send email.
