# Sports Tracker — Superliga daily email

Technical design for a Node.js/TypeScript job that scrapes the official Brazilian Volleyball Confederation (CBV) website and emails a daily Superliga digest.

The digest covers all men's and women's Superliga A teams: today's matches, yesterday's results, and complete standings for each competition. It is written in English and sent to `vinicius@hisao.com.br` every day at **4:00 PM America/Toronto**, using cron on the owner's server.

## Documentation

- [Architecture and product requirements](docs/architecture.md)
- [Implementation specification](docs/implementation.md)
- [Deployment and operations](docs/operations.md)
- [CBV source research and remaining verification](docs/cbv-sources.md)

## Project status

This repository currently contains configuration from an earlier Londrina/TheSportsDB design, including a GitHub Actions workflow and an environment example. The service described here is **a specification, not an implemented or deployed application**. No email was sent or schedule installed while writing these documents.

The existing `.env.example` and `.github/workflows/daily-londrina-email.yml` do not implement this design. The operations guide specifies their migration. Existing private configuration was not inspected or changed.

Documentation prepared on October 15, 2026. Runtime, dependency versions, sender identity, and SMTP provider must be selected and verified during implementation.
