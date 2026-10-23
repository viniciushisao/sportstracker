# Sports Tracker — Superliga daily email

A Node.js/TypeScript job that scrapes the official CBV website and emails today's games, yesterday's results, and complete men's and women's Superliga A standings to `vinicius@hisao.com.br`.

Production target: the owner's **A2 Hosting Basic plan**, using cron at **4:00 PM America/Toronto**. Emails are in English, with Toronto match times and official Portuguese team names. Deployment was verified on A2 on October 19, 2026; see the operations log below.

## Run locally

Use Node.js **24 LTS** (minimum 22.12 with the SQLite flag supplied by the scripts).

```sh
npm ci
cp .env.example .env
npm run check
npm run build
npm run preview
```

`npm run preview` uses saved official HTML and the sample date October 26, 2026. Open `output/digest.html` or `output/digest.txt`. It does not contact CBV or send email.

To retrieve current CBV data and generate today's preview:

```sh
npm run daily -- --dry-run
```

To preview another calendar date using the currently published season:

```sh
npm run daily -- --dry-run --date 2026-10-26 --output output/example
```

To send after configuring SMTP and inspecting a preview:

```sh
npm run daily -- --send
```

`--send` explicitly overrides the default `DRY_RUN=true`. Never combine it with fixtures. Production cron uses the compiled job; see the deployment guide.

## Behavior

- Retrieves CBV's public HTML; parses embedded page data as JSON, without executing website scripts or using a sports API.
- Checks season, competition, complete standings, all pairings in each published regular-season leg, match IDs, timestamps, and scores before sending.
- Generates HTML and plain-text email, including empty-day messages and pending results.
- Uses SQLite and a process lock to prevent concurrent or repeated daily sends.
- Sends sanitized failure notifications when email configuration is usable. Uncertain SMTP delivery requires operator review before retrying.
- Defaults to preview mode. Secrets, previews, state, and logs are ignored by Git.

## Documentation

- [Architecture and product requirements](docs/architecture.md)
- [Implementation details and limitations](docs/implementation.md)
- [A2 Hosting deployment and operations](docs/operations.md)
- [CBV source research](docs/cbv-sources.md)
- [Official test fixture provenance](test/fixtures/cbv/README.md)

## Verification and deployment status

The implementation has been tested against saved official current-season and historical HTML, and a live dry-run verified **132 matches and 12 standings rows per competition**. Tests cover parser failures, Toronto daylight-saving boundaries, rendering, delivery-state recovery, concurrent jobs, and error notifications. GitHub Actions runs checks only; it does not send email or schedule production jobs.

The A2 deployment and active cron schedule were inspected on October 19, 2026. A parser fix now accepts a complete first leg while CBV has not published the return leg. All 40 tests pass, and a live server preview validated 66 matches and 12 standings rows per competition. No manual email was sent during this repair. See `docs/operations.md` for current deployment details.

## Toronto university home volleyball reminders

A separate `--university` job tracks U of T Varsity Blues and TMU Bold, men and
women. It sends one combined email every day at **4 PM America/Toronto**, including
eligible home games today or tomorrow. On no-game days, live schedule validation
and saved-example parser checks must pass before an all-clear email is sent. Away and neutral games are excluded,
even in Toronto; home games relocated outside Toronto are also excluded.
Each email includes local start times, the published gym, a verified street
address where known, and official schedule/ticket links. A game before 4 PM still
appears in its game-day email, labelled as past its scheduled start or final.
Cancelled/postponed games and unconfirmed playoff placeholders are excluded.

```sh
npm run preview:university
npm run university -- --dry-run
npm run check
npm run build
```

Previews are written to `output/university/digest.html` and `digest.txt`. No-game
previews show the daily health report and identify offline fixture mode. Fixture mode cannot send email.
The job reuses existing SMTP settings and `EMAIL_TO`. `UNIVERSITY_SEASON` defaults
to `2026-2027`. It has separate state/locking and delivery keys from Superliga.

Production activation requires deploying the build and adding the university cron
entry in [operations](docs/operations.md#university-home-volleyball-reminders).
Adding this code does not change the existing server schedule.

## Daily no-game health emails

Both jobs send every day at 4 PM Toronto time. University emails contain today's
and tomorrow's eligible home games. Superliga retains today's games, yesterday's
results and standings. When neither of a job's game windows contains games, it
also runs production parser checks against bundled saved official examples.
Only successful live collection/validation and successful saved-example checks
produce “Everything looks fine.” Failures use the existing failure email path.
Superliga standings remain included on its no-game days.

Deploy `test/fixtures/cbv` and `test/fixtures/university` alongside `dist`. These
checks run with production dependencies; they do not require TypeScript or the
development test runner. They check expected counts and invalid-input rejection;
university checks also verify home venues and exclusion of a known away game.
The full development suite remains `npm run check`. Offline previews explicitly
state that live sources were not contacted.
