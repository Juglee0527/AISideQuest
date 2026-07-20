# Current State

Last verified: 2026-07-20
Application version: `0.1.0`  
Runtime: Node.js 22, React 19, NestJS 11, PostgreSQL 16

## Delivery status

Tasks 1–19 are implemented. Task 20 has repository implementation and a local deployment rehearsal, but remains externally incomplete. Discover task 21 has its documentation and product contract complete; tasks 22–33 are not implemented.

Implemented:

- Developer-operated, local-first distribution with one-command PostgreSQL, migration/seed, API, and web startup via `npm run dev:local`.
- GitHub OAuth with state, PKCE, server-side hashed sessions, secure cookies, and CSRF.
- Device linking, rotation, revocation, and hash-only token storage.
- Concurrent Codex-hook AI sessions with per-session elapsed-time cards, heartbeat, durable FIFO queue, recovery, and expiration. Home is read-only for session lifecycle; manual endpoints remain recovery-only API compatibility.
- Home session cards show only a locally sanitized final-folder label and fixed-allowlist operation label; full paths, raw commands, arguments, and tool results never enter persistence or delivery.
- Published quest catalog, resumable quiz attempts, server grading, and retry policy.
- Transactional 100P point ledger with duplicate/concurrency protection.
- Server statistics using saved IANA time zones.
- Security matrix, rate limits, export/delete, redaction, structured logs, metrics, alerts, backup/restore tooling.
- CI, PostgreSQL integration, migration/upgrade, Chromium core flow, immutable deployment image workflow.
- Staging/production deployment templates, validation, migration-first deploy, smoke, rollback, kill switches, and pilot evaluator.

Optional external deployment remains unverified:

- real staging and production domains, hosts, PostgreSQL databases, and distinct GitHub OAuth Apps;
- live HTTPS and browser verification with real credentials;
- production backup/restore and application rollback evidence;
- at least 10 invited users completing the full flow;
- at least 7 days and 100 eligible automatic sessions before final pilot evaluation.

## Last verification

| Suite | Passed |
|---|---:|
| React | 50 |
| Codex plugin | 20 |
| operations and local startup scripts | 17 |
| server non-database | 19 |
| PostgreSQL integration | 51 |
| total | 157 |

Also passed: lint, client/server typecheck, client/server production build, 14 migrations with full revert/reapply coverage, Docker API/web builds, and 10 deployment smoke checks.

## Operational defaults

| Setting | Contract |
|---|---|
| API prefix | `/api/v1` |
| browser origin | exactly one configured `CORS_ORIGIN` |
| auth session | 168 hours by default; allowed 1–720 |
| automatic timeout | 120 seconds after last valid activity |
| concurrent automatic sessions | one active turn per hashed Codex session key; different keys may run together |
| manual timeout | 12 hours after start |
| late `Stop` recovery | heartbeat-timeout only, same device/turn, within 24 hours |
| quiz submission grace | 5 minutes after AI session end |
| reward | 100P, once per user + quest version |
| API JSON body | 16 KiB maximum |
| turn event limit | 500 persisted events |
| plugin active queue | 10,000 records or 10 MiB, maximum 48 hours |
| plugin dead letter | 7 days |
| primary runtime | developer-owned local repository and services |
| integrated local start | `npm run dev:local` |

## Kill switches

- `INTEGRATION_EVENTS_ENABLED=false` returns retryable `503 INTEGRATION_EVENTS_PAUSED` with `Retry-After: 60` after device authentication.
- `QUEST_REWARDS_ENABLED=false` returns `503 QUEST_REWARDS_PAUSED` before the grading transaction begins.
- Both values must be explicitly configured in production.

## Immediate next action

Begin task 22 in the ordered [`Discover development plan`](../Discover_개발_계획.md): define the common Discover model and browser API against [`DISCOVER_CONTRACT.md`](./DISCOVER_CONTRACT.md). Keep the default product path free and local-first. External deployment and the pilot in [`DEPLOYMENT_AND_PILOT.md`](./DEPLOYMENT_AND_PILOT.md) remain a separate optional track; never mark task 20 complete without its real evidence.
