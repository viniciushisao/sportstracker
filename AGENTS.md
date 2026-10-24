# Publishing
Every production publication must run type checking, automated tests, and a build,
validate a live preview, then send the selected job's daily email.
Use scripts/publish.sh after updating the server checkout and dependencies.
Default: Superliga. Use --university for a university publication.
A successful publication deliberately sends a fresh email even if today's digest
was already accepted. Never bypass an uncertain delivery or an active job lock.
Do not report publication complete unless the send was accepted by SMTP.
A user request to change locally does not authorize deployment or sending email.
