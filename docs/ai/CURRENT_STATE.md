# Current State

Last verified: 2026-07-18  
Application version: `0.1.0`  
Runtime: Node.js 22, React 19, NestJS 11, PostgreSQL 16

## Delivery status

Tasks 1–19 are implemented. Task 20 has repository implementation and a local deployment rehearsal, but remains externally incomplete.

Implemented:

- GitHub OAuth with state, PKCE, server-side hashed sessions, secure cookies, and CSRF.
- Device linking, rotation, revocation, and hash-only token storage.
- Manual and Codex-hook AI sessions with heartbeat, durable FIFO queue, recovery, and expiration.
- Published quest catalog, resumable quiz attempts, server grading, and retry policy.
- Transactional 100P point ledger with duplicate/concurrency protection.
- Server statistics using saved IANA time zones.
- Security matrix, rate limits, export/delete, redaction, structured logs, metrics, alerts, backup/restore tooling.
- CI, PostgreSQL integration, migration/upgrade, Chromium core flow, immutable deployment image workflow.
- Staging/production deployment templates, validation, migration-first deploy, smoke, rollback, kill switches, and pilot evaluator.

Externally pending:

- real staging and production domains, hosts, PostgreSQL databases, and distinct GitHub OAuth Apps;
- live HTTPS and browser verification with real credentials;
- production backup/restore and application rollback evidence;
- at least 10 invited users completing the full flow;
- at least 7 days and 100 eligible automatic sessions before final pilot evaluation.

## Last verification

| Suite | Passed |
|---|---:|
| React | 47 |
| Codex plugin | 10 |
| operations scripts | 11 |
| server non-database | 19 |
| PostgreSQL integration | 45 |
| total | 132 |

Also passed: lint, client/server typecheck, client/server production build, Docker API/web builds, 11 migrations, idempotent migration rerun (`applied: []`), and 10 deployment smoke checks.

## Operational defaults

| Setting | Contract |
|---|---|
| API prefix | `/api/v1` |
| browser origin | exactly one configured `CORS_ORIGIN` |
| auth session | 168 hours by default; allowed 1–720 |
| automatic timeout | 120 seconds after last valid activity |
| manual timeout | 12 hours after start |
| late `Stop` recovery | heartbeat-timeout only, same device/turn, within 24 hours |
| quiz submission grace | 5 minutes after AI session end |
| reward | 100P, once per user + quest version |
| API JSON body | 16 KiB maximum |
| turn event limit | 500 persisted events |
| plugin active queue | 10,000 records or 10 MiB, maximum 48 hours |
| plugin dead letter | 7 days |

## Kill switches

- `INTEGRATION_EVENTS_ENABLED=false` returns retryable `503 INTEGRATION_EVENTS_PAUSED` with `Retry-After: 60` after device authentication.
- `QUEST_REWARDS_ENABLED=false` returns `503 QUEST_REWARDS_PAUSED` before the grading transaction begins.
- Both values must be explicitly configured in production.

## Immediate next action

Do not add more product scope by default. The next milestone is external deployment and pilot execution using [`DEPLOYMENT_AND_PILOT.md`](./DEPLOYMENT_AND_PILOT.md).

