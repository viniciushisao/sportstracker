# A2 Hosting deployment and operations

## Hosting target and prerequisites

Use the owner's existing **A2 Hosting Basic plan**. GitHub stores the source and runs checks. A2 executes the daily production job through cron. The account has not yet been inspected, and nothing has been deployed or scheduled there.

Before launch, verify:

- Node.js 24 LTS, or a maintained Node.js 22 release at least 22.12, executable from cron with built-in SQLite available.
- Cron access, private writable persistent storage, and a way to upload/deploy the compiled application.
- Outbound HTTPS connections to CBV and TLS connections to the chosen SMTP provider.
- Memory and execution limits sufficient for a live dry-run (the local run completed in a few seconds; hosting performance is unverified).
- An authenticated SMTP account and verified sender.

Browser automation is unnecessary for the current adapter. Root access, a public web endpoint, and a continuously running Node process are unnecessary. Inspect Node.js, Cron Jobs, and Terminal/SSH features in the hosting panel. If unavailable, document the specific limitation before upgrading or changing platforms.

## Install and configure

Choose a private application directory outside `public_html`, for example `/home/ACCOUNT/apps/sportstracker`. Replace `ACCOUNT` and the Node path below with actual account values.

```sh
cd /home/ACCOUNT/apps/sportstracker
npm ci
npm run check
npm run build
cp .env.example .env
chmod 600 .env
```

If builds are not possible on A2, build on a compatible environment and upload `dist`, package manifests, and the wrapper, then install production dependencies with `npm ci --omit=dev`. Production uses compiled JavaScript; `tsx` and TypeScript are not needed at runtime.

Edit `.env` privately:

| Variable | Value / purpose |
| --- | --- |
| `DRY_RUN` | Keep `true` until preview and SMTP verification; set `false` for production cron |
| `TIMEZONE` | `America/Toronto` |
| `CBV_SEASON` | `2026-2027`; update only after verifying next season |
| `CBV_MEN_URL` | Current official men's competition URL from `.env.example` |
| `CBV_WOMEN_URL` | Current official women's competition URL from `.env.example` |
| `EMAIL_TO`, `ERROR_EMAIL_TO` | `vinicius@hisao.com.br` |
| `EMAIL_FROM` | Verified sender address; plain address without display name |
| `SMTP_HOST`, `SMTP_PORT` | Provider settings; port defaults to 587 |
| `SMTP_SECURE` | `false` for mandatory STARTTLS (usually 587), `true` for implicit TLS (usually 465) |
| `SMTP_USER`, `SMTP_PASS` | Private provider credentials |
| `STATE_DB_PATH` | Absolute private path, e.g. `/home/ACCOUNT/private/sportstracker/state.sqlite` |

`ENV_FILE` may point to a separate private environment file. Existing process environment variables take precedence over `.env`. Source timestamps already carry offsets, so no `CBV_SOURCE_TIMEZONE` is required. SQLite state and previews must not be in a publicly served directory.

Run a compiled live preview using the actual account Node executable:

```sh
NODE_BIN=/absolute/path/to/node ./scripts/run-daily.sh --dry-run
```

Inspect `output/digest.html`, `output/digest.txt`, and the source counts. Verify Node/SQLite access, file permissions, and CBV access on A2. Compare the preview with both official competition pages. Then perform one controlled send:

```sh
NODE_BIN=/absolute/path/to/node ./scripts/run-daily.sh --send
```

This sends to the configured recipient even while `DRY_RUN=true`. Verify delivery and rendering in the actual inbox before setting `DRY_RUN=false`. A successful send records that day's digest; later normal invocations skip it.

## Cron at 4 PM Toronto

On a host with verified `CRON_TZ` support:

```cron
CRON_TZ=America/Toronto
0 16 * * * NODE_BIN=/absolute/path/to/node /home/ACCOUNT/apps/sportstracker/scripts/run-daily.sh >> /home/ACCOUNT/private/sportstracker/cron.log 2>&1
```

On cPanel/cron without verified timezone support, use the application gate:

```cron
* * * * * NODE_BIN=/absolute/path/to/node /home/ACCOUNT/apps/sportstracker/scripts/run-daily.sh --scheduled >> /home/ACCOUNT/private/sportstracker/cron.log 2>&1
```

The second entry starts a small process each minute; the application performs the daily work only at 16:00 `America/Toronto`, following DST automatically. Confirm the account permits every-minute cron before choosing this option. Install only one production schedule. Keep `DRY_RUN=false` in the private environment file; do not embed SMTP secrets in cron.

Create the private log directory before adding cron. Use absolute executable and script paths because cron's PATH is usually minimal. The wrapper fixes the working directory; the application owns locking and its ten-minute deadline.

Setting Node's `TZ` does not change cron's scheduling timezone. The process starts at 16:00; retrieval/provider processing add latency before inbox arrival. Cron does not catch up after server downtime. Run manually for the current date after recovery; historical sends require `--date` explicitly.

There is no legacy production workflow in the current checkout. `.github/workflows/check.yml` performs offline checks only. Disable any old external schedule still configured elsewhere to avoid multiple senders.

## Failure recovery

| Symptom | Action |
| --- | --- |
| Source timeout or rate limit | Inspect sanitized error category and retry after recovery |
| Parser/coverage failure | Inspect restricted `output/sources` HTML, compare CBV markup, update parser and fixtures, then test and preview |
| Wrong season | Verify official URLs, new roster, and schedule before changing `CBV_SEASON` |
| SMTP rejection | Correct credentials, sender, or provider configuration; retry definite rejections |
| `DELIVERY_BLOCKED` | Inspect provider logs using the stored Message-ID; never assume an unresolved email failed |
| `STALE_LOCK` | Read `STATE_DB_PATH.lock/owner.json`, verify the process stopped, reconcile delivery state, then remove only that lock directory |
| No run/error email | Inspect cron, uptime, permissions, runtime, disk, and provider connectivity |
| Database failure | Restore a verified backup and reconcile provider delivery records before re-enabling sends |

To inspect delivery history with an available SQLite client:

```sql
SELECT digest_key, status, message_id, reason, updated
FROM deliveries ORDER BY updated DESC LIMIT 20;
```

After reviewing provider evidence, a deliberate resend is:

```sh
NODE_BIN=/absolute/path/to/node ./scripts/run-daily.sh --send --date 2026-10-26 --resend-reason "Provider confirmed no delivery"
```

This creates a new attempt and Message-ID, preserving the reason. Prior unresolved attempts become `superseded`; they are not proof of rejection. If the previous email did arrive, the override can create a duplicate. Do not automate this flag.

Exit codes: `0` for acceptance, preview, already-sent skip, not-due skip, or active-lock skip; `1` for operational failure; `2` for invalid configuration. A hard timeout exits `1` and may leave the lock for review.

## Logs, backups, and retention

Logs contain run ID, digest date, stage, duration, source counts, and sanitized error codes. Unexpected exception messages are suppressed to avoid leaking credentials. Raw HTML, snapshots, and email previews are private local diagnostics and are ignored by Git.

Configure log rotation on the server (initial recommendation: 30 days). Source diagnostics/preview files are overwritten on each run. SQLite snapshots and run history accumulate; schedule cleanup of snapshots/runs older than 30 days and resolved delivery history older than one season only after establishing backups. Retain unresolved attempts until reconciled. Retention cleanup is an operator responsibility, not an automatic job feature.

Use SQLite's online backup facilities or stop the job and checkpoint before backing up; do not copy only the main database while a WAL write is active. Test recovery before relying on backups.

SMTP acceptance is not an inbox guarantee. Provider outages, invalid credentials, a stopped server, or a hard crash can prevent error emails. Independent missed-run monitoring can cover this gap but is not configured.

## Remaining launch work

1. Verify the A2 Basic account capabilities and choose account paths/Node executable.
2. Configure SMTP provider and verified sender privately.
3. Run the compiled preview and controlled delivery on A2; inspect desktop/mobile inbox rendering.
4. Enable one cron schedule, observe the first scheduled run, and configure backups/log rotation.
