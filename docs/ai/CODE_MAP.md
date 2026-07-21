# Code Map

## Top-level ownership

| Path | Responsibility |
|---|---|
| `src/` | React application, API clients, contexts, browser state, pages |
| `server/src/` | NestJS API and domain logic |
| `server/src/database/migrations/` | ordered PostgreSQL schema source of truth |
| `server/test/` | non-DB and PostgreSQL contract tests |
| `plugins/aisidequest/` | Codex hook plugin, privacy filter, queue, worker, device connection |
| `deploy/` | API/web images, Caddy, Compose, environment templates, pilot sample |
| `scripts/` | integrated local startup plus backup/restore, alert, deploy, rollback, smoke, environment and pilot tools |
| `e2e/` | Chromium core user-flow test |
| `ops/` | Prometheus alert rules |
| `.github/workflows/` | CI and immutable image release workflows |
| `docs/` | Korean human documentation |
| `docs/ai/` | canonical AI technical context and historical technical references |

## Server domains

| Path | Owns |
|---|---|
| `server/src/auth/` | GitHub OAuth, cookies, sessions, CSRF, recent-auth, export/delete |
| `server/src/devices/` | link codes, device credentials, rotation, revocation |
| `server/src/sessions/` | session API, integration events, state transitions, cleanup/recovery |
| `server/src/quests/` | catalog, attempts, answers, grading, retry, reward transaction |
| `server/src/points/` | balance and immutable ledger reads |
| `server/src/statistics/` | time-zone-aware summary and activity |
| `server/src/discover/` | common Discover types, adapter contract, bounded HTTP/normalization boundary, PostgreSQL cache, source aggregation and read API |
| `server/src/security/` | shared PostgreSQL rate limits |
| `server/src/observability/` | structured logging, metrics, sanitization |
| `server/src/health/` | liveness, readiness, protected metrics endpoint |
| `server/src/config/` | application environment parsing and production fail-fast rules |
| `server/src/database/` | connection, transactions, migrations, seed, readiness |

## Frontend flow

`src/App.tsx` defines the routes:

- `/` → home and current AI-session summary;
- `/quests` → published quest catalog;
- `/quests/:code` and `/quest-attempts/:attemptId` → quiz start/resume;
- `/dashboard` → server statistics and point history;
- `/devices` → device link, rotation, and revocation.

API calls belong in `src/api/`. Cross-page server state belongs in `src/contexts/`. Page-specific rendering remains in `src/pages/`; reusable UI stays in `src/components/`.

Discover currently has `src/types/discover.ts` and `src/api/discoverApi.ts`, but no route or page. The shared adapter and cache infrastructure is implemented; Hacker News and Remotive are enabled only by tasks 24-25.

## Change routing

| Requested change | Start here | Verify with |
|---|---|---|
| OAuth/cookie/CSRF | `server/src/auth/`, `src/contexts/AuthContext.tsx` | auth integration + app e2e |
| hook/session behavior | plugin `scripts/`, `server/src/sessions/` | plugin + session integration |
| quiz/reward | `server/src/quests/`, `server/src/points/` | quest-attempt integration |
| statistics | `server/src/statistics/`, dashboard page | statistics integration + React |
| schema | new migration; never edit applied migration casually | migration + all PostgreSQL tests |
| deployment | `deploy/`, `scripts/deploy-release.ps1` | env tests + Docker rehearsal + smoke |
| privacy/logging | plugin filter, DTOs, observability sanitizer | forbidden-data and redaction tests |
| local startup | `scripts/dev-local.mjs`, root `package.json` | operations tests + local readiness smoke |
| Discover behavior | `DISCOVER_CONTRACT.md`, `server/src/discover/`, `src/api/discoverApi.ts`; future `src/pages/DiscoverPage.tsx` | source adapter + server contract + React tests |
