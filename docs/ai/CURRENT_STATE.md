# Current State

Last verified: 2026-07-21
Application version: `0.1.0`  
Runtime: Node.js 22, React 19, NestJS 11, PostgreSQL 16

## Delivery status

Tasks 1–19 are implemented. Task 20 has repository implementation and a local deployment rehearsal, but remains externally incomplete. Discover tasks 21-30 have the product contract, common model, authenticated read API, safe adapter/cache infrastructure, Hacker News, Remotive, DEV, Stack Overflow, conditional GitHub Issues, the Discover screen, user-owned saved items, and explicit-interest personalization complete. Tasks 31-33 are not implemented.

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
- Discover common server/client types, authenticated read API, bounded HTTP and plain-text normalization boundaries, shared PostgreSQL cache, per-source single-flight/stale fallback and low-cardinality counters.
- Enabled Hacker News Top·Ask·Show·Jobs adapter with bounded request volume, duplicate/deleted/incomplete item handling, HTTPS fallback links, 10-minute fresh TTL, and 24-hour maximum stale fallback.
- Enabled Remotive Software Development adapter with one shared bounded request, direct source URL and attribution, explicit compensation availability, employment-type tags, 6-hour fresh TTL, and 72-hour maximum stale fallback.
- Enabled public Forem V1 DEV adapter with one shared 30-article request, exact DEV HTTPS links and attribution, bounded description and tags, nullable reading time and reaction engagement, 30-minute fresh TTL, and 24-hour maximum stale fallback.
- Enabled Stack Exchange API v2.3 Stack Overflow adapter with fixed featured and unanswered requests, one 30-question page per method, reputation-only bounties, method backoff, shared one-minute request spacing, quota exhaustion handling, a 15-minute fresh TTL, and 24-hour maximum stale fallback.
- Conditional GitHub Search Issues adapter using a server-only fine-grained token and explicit organization/repository allowlists. It performs one 30-item, issue-only, open, unassigned search per shared 30-minute refresh, excludes pull requests and out-of-scope results defensively, honors the separate search rate-limit headers, and falls back to cache for at most 24 hours. Without the token and a scope, GitHub remains disabled.
- Authenticated `/discover` desktop/mobile screen with earning, news, and community tabs, safe external cards, cursor load-more, and distinct loading, empty, stale, partial-failure, total-failure, and paging-error states. It remains independent of active AI sessions and collects no implicit analytics.
- User-owned Discover saved snapshots with CSRF/idempotent save and delete, unique duplicate protection, stable cursor listing independent of source availability, explore/saved UI, and export/account-deletion handling.
- Explicit Discover interests with a fixed 20-tag allowlist, maximum 10 selections, CSRF/idempotent full replacement, exact chronological empty default, deterministic match/recency/engagement/value ordering, visible reason codes, cursor invalidation, and export/account-deletion handling. Prompts, AI responses, code, paths, transcripts, and tool content are not inputs.

Optional external deployment remains unverified:

- real staging and production domains, hosts, PostgreSQL databases, and distinct GitHub OAuth Apps;
- live HTTPS and browser verification with real credentials;
- production backup/restore and application rollback evidence;
- at least 10 invited users completing the full flow;
- at least 7 days and 100 eligible automatic sessions before final pilot evaluation.

## Last verification

| Suite | Passed |
|---|---:|
| React | 65 |
| Codex plugin | 20 |
| operations and local startup scripts | 18 |
| server non-database | 66 |
| PostgreSQL integration | 58 |
| total | 227 |

Also passed: lint, client/server typecheck, client/server production build, 17 migrations with full revert/reapply coverage, Docker API/web builds, and 10 deployment smoke checks.

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
| Discover list | browser session, no active AI session; default 20 and maximum 50 items |
| Discover interests | fixed allowlist; maximum 10; empty means chronological order |
| DEV article source | one public Forem V1 page; 30-minute fresh and 24-hour maximum stale |
| Stack Overflow source | two fixed v2.3 methods, one 30-item page each; 15-minute fresh and 24-hour maximum stale |
| GitHub source | optional server-only token plus approved org/repo scopes; one 30-item Search Issues page; 30-minute fresh and 24-hour maximum stale |

## Kill switches

- `INTEGRATION_EVENTS_ENABLED=false` returns retryable `503 INTEGRATION_EVENTS_PAUSED` with `Retry-After: 60` after device authentication.
- `QUEST_REWARDS_ENABLED=false` returns `503 QUEST_REWARDS_PAUSED` before the grading transaction begins.
- Both values must be explicitly configured in production.

## Immediate next action

Begin task 31 in the ordered [`Discover development plan`](../Discover_개발_계획.md): investigate Algora and register no adapter unless a supported public global-discovery route or approved organization allowlist produces a documented GO decision. Keep the default product path free and local-first. External deployment and the pilot in [`DEPLOYMENT_AND_PILOT.md`](./DEPLOYMENT_AND_PILOT.md) remain a separate optional track; never mark task 20 complete without its real evidence.
