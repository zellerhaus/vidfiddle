# Security

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/zellerhaus/vidfiddle/security/advisories/new)
instead, with the steps to reproduce and what an attacker could do. If that doesn't work for you,
email [contact@vidfiddle.com](mailto:contact@vidfiddle.com). You'll get a reply within a few days, and
credit in the fix's release notes if you want it.

Only the latest release gets security fixes.

## How Vidfiddle is meant to run

Knowing the design helps tell a bug from a choice:

- It's a single-user app behind one password (`APP_PASSWORD`). Sessions are HMAC-signed cookies.
- `/media/...` is public on purpose, because social platforms fetch videos by URL. File keys are
  unguessable; anyone with a link can still open that file.
- `/api/cron/...` is guarded by `CRON_SECRET`. The worker accepts no requests apart from a health
  check. Publer webhooks are checked against an HMAC signature.
- Put it behind HTTPS if it's reachable from the internet, and use long random values for every secret.
