# Sports Tracker — Superliga daily email

A Node.js/TypeScript job that scrapes the official CBV website and emails today's games, yesterday's results, and complete men's and women's Superliga A standings to `vinicius@hisao.com.br`.

Production target: the owner's **A2 Hosting Basic plan**, using cron at **4:00 PM America/Toronto**. Emails are in English, with Toronto match times and official Portuguese team names. Hosting compatibility and SMTP setup still need verification before deployment.

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
- Checks season, competition, complete standings, all regular-season pairings, match IDs, timestamps, and scores before sending.
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

No production email has been sent, no A2 account settings have been changed, and no cron schedule has been installed. Select a verified sender and configure SMTP privately on A2 before launch. Browser automation is not required for the inspected CBV pages.
