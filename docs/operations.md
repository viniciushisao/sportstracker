# Deployment and operations

This guide describes the intended deployment after implementation. There is currently no runnable service or cron wrapper in the repository.

## Configuration

Keep secrets in a server-owned environment file readable only by the service account. Do not commit SMTP credentials, the recipient's runtime delivery history, raw snapshots, or email previews.

| Variable | Proposed value / purpose |
| --- | --- |
| `EMAIL_TO` | `vinicius@hisao.com.br` |
| `ERROR_EMAIL_TO` | `vinicius@hisao.com.br` |
| `EMAIL_FROM` | Required verified sender; not yet selected |
| `SMTP_HOST`, `SMTP_PORT` | Provider-specific; not yet selected |
| `SMTP_USER`, `SMTP_PASS` | Provider credentials |
| `SMTP_SECURE` | Provider-specific implicit TLS setting; require TLS for submission |
| `TIMEZONE` | `America/Toronto` |
| `EMAIL_LOCALE` | `en-CA` |
| `CBV_SEASON` | Explicit supported season; initial research identified `2026-2027` |
| `CBV_MEN_URL` | `https://cbv.com.br/volei-de-quadra/superliga-a-masculina` |
| `CBV_WOMEN_URL` | `https://cbv.com.br/volei-de-quadra/superliga-a-feminina` |
| `CBV_SOURCE_TIMEZONE` | Required after verifying CBV's published timezone convention |
| `STATE_DB_PATH` | `/var/lib/sportstracker/state.sqlite` |
| `DRY_RUN` | Default `true` until delivery validation is complete |

The adapter configuration must also record verified games/results/standings URLs, season coverage, and roster information. Do not reuse the old `SPORTS_API_*` settings for CBV.

## Deployment sequence

1. Select the server OS, supported Node.js LTS release, package versions, and SMTP provider. Verify a sender and the provider's domain authentication requirements.
2. Implement and verify the modules and tests in the implementation specification. Add the actual package scripts and production wrapper before using the commands below.
3. Deploy an immutable build under `/opt/sportstracker`, owned by a dedicated service account. Install locked dependencies and compile TypeScript during deployment, not every scheduled run.
4. Provision writable state/log directories and restrictive configuration permissions. Ensure time synchronization and timezone data are maintained.
5. Run tests and a live dry-run, compare all four sections with CBV, then perform one controlled email delivery to the configured recipient.
6. Disable/remove the legacy Londrina GitHub Actions schedule as part of implementation migration. Update `.env.example` to the CBV configuration above. Keep one production scheduler.
7. Install and verify cron. Observe the first scheduled run and record its start time, acceptance time, and delivery outcome.

## Scheduling at 4 PM Toronto

Recommended cron entry **only on a cron implementation that supports `CRON_TZ`**:

```cron
CRON_TZ=America/Toronto
0 16 * * * /opt/sportstracker/scripts/run-daily.sh >> /var/log/sportstracker/cron.log 2>&1
```

The wrapper must set an explicit working directory and executable paths, securely load the environment, acquire a lock, apply a ten-minute total execution budget, invoke the compiled job, and preserve its exit status. Proposed paths are deployment conventions, not existing files. Do not place credentials directly in crontab.

`CRON_TZ` support must be checked on the actual server. Setting Node's `TZ` or the application's `TIMEZONE` does not change cron's scheduling timezone. If the cron implementation lacks timezone support, use a Toronto-configured host or an every-minute cron entry plus an application due-time gate evaluated in `America/Toronto`; the gate must allow only the 16:00 invocation and use the daily delivery key to prevent duplicates. Verify DST behavior on the deployed scheduler rather than replacing Toronto with a fixed UTC offset.

Schedule the job at 16:00 daily, including weekends, holidays, and the off-season. Source retrieval and provider processing add latency before arrival. A server that was down at 16:00 does not automatically catch up with ordinary cron. Default recovery is an operator-triggered run for the current Toronto date; historical sends require explicit dates and are not automatic.

## Logging and retention

Emit structured logs with run ID, digest date, stage, duration, source URLs, record counts, parser version, status, and sanitized error category. Never log SMTP passwords or complete configuration. Suggested starting retention: 30 days of logs and restricted diagnostic HTML/snapshots; one season of delivery metadata. Configure rotation and cleanup, plus SQLite backup and restore procedures.

Fetch time is not source freshness: an unchanged valid standings table is normal on a no-game day. Show the source's own update time when published and do not claim that fetching a page proves all results are current.

## Recovery procedures

| Symptom | Action |
| --- | --- |
| Source timeout/rate limiting | Inspect status and retry timing; retry after recovery, preserving the daily delivery key |
| Parser/validation failure | Inspect saved HTML, compare live CBV markup, update adapter and fixtures, run checks, then preview before resending |
| Wrong season | Verify official current-season pages and roster, update configuration, and validate both competitions |
| SMTP credentials/sender failure | Correct provider configuration, verify the sender, and retry only definitely rejected attempts |
| Delivery marked `sending` or `unknown` | Check provider records by Message-ID before retrying; duplicate delivery is possible if acceptance cannot be established |
| No run record or error email | Inspect cron, server uptime, permissions, disk space, logs, and SMTP availability |
| Corrupt/unavailable state | Restore a verified backup and reconcile provider records before enabling sends |

Exit statuses to implement: `0` for successful delivery, dry run, or already-delivered skip; `1` for operational failure; `2` for invalid configuration. A lock-contention skip should be recorded separately and exit `0`, because the active instance owns the run.

A source error can be emailed while the provider is healthy. A server outage or provider-wide outage cannot reliably be reported through that same server/provider. Optional independent uptime or missed-run monitoring can cover that gap; it is not configured by this documentation.

## Remaining launch decisions

- SMTP provider, verified sender, and credentials.
- Server OS, cron implementation, deployment account, and exact paths.
- Verified CBV source timezone, final-result markup, complete schedule coverage, and men's standings navigation.
- Runtime and dependency versions, and whether browser rendering is necessary.

The recipient, 16:00 Toronto schedule, English language, CBV scraping, and men's/women's coverage are already settled.
