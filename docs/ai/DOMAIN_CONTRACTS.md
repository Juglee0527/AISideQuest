# Domain Contracts

This is the compact English contract for routine AI-assisted changes. The longer documents in this directory preserve detailed design rationale and implementation history.

## Authentication

- GitHub OAuth starts at `GET /api/v1/auth/github` and uses a one-time state record plus PKCE S256.
- OAuth state and device link codes expire after 10 minutes and cannot be replayed.
- GitHub numeric user ID is the stable external identity. Display login/name/avatar may change.
- Browser sessions are random opaque tokens. Only their hashes are stored in PostgreSQL.
- Production auth cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, `Path=/`, and an appropriate `SameSite` policy.
- Browser mutation endpoints require the authenticated cookie plus CSRF proof.
- Export and account deletion additionally require authentication no older than 15 minutes.
- Account deletion removes owned primary data in one transaction. Local plugin files must be deleted by the user.

## Devices

- The default connection creates local verifier/token material, sends only their hashes, opens a 10-minute browser approval request, and stores the credential after approval.
- A browser-authenticated single-use link code remains recovery-only for environments that cannot open the approval page.
- The raw device token is stored only in the user's local `device.json`. The server stores a SHA-256 hash.
- Rotation issues a new link flow and invalidates the previous credential after successful replacement.
- Revocation is idempotent and blocks subsequent device authentication immediately.
- Safe device metadata may include name, plugin version, last seen time, and bounded queue diagnostics; never raw queue content.

## AI sessions

States: `RUNNING`, `WAITING_FOR_USER`, `COMPLETED`, `FAILED`, `ABANDONED`.

Origins: `HOOK` or `MANUAL`. Timing quality: `EXACT` or `DEGRADED`.

| Event | Effect |
|---|---|
| `SessionStart` | records a provider lifecycle event; does not create a turn session |
| `UserPromptSubmit` | creates or links the active session for the hashed turn |
| `PreToolUse` | activity only; preserves current active state |
| `PermissionRequest` | transitions active session to `WAITING_FOR_USER` |
| `PostToolUse` | transitions active session to `RUNNING` |
| `Heartbeat` | activity only; may carry bounded queue diagnostics |
| `Stop` | transitions to `COMPLETED` with `HOOK_STOP` |

- PostgreSQL guarantees at most one `RUNNING`/`WAITING_FOR_USER` session per user.
- A new turn may supersede the previous active automatic turn.
- Unknown non-start events are stored as `DEFERRED`; start arrival reprocesses them in order.
- Automatic sessions become `ABANDONED` exactly at last valid activity + 120 seconds.
- Pure manual sessions become `ABANDONED` exactly at start + 12 hours.
- Orphan deferred events are ignored after 24 hours.
- A late `Stop` can recover only a session abandoned by `HEARTBEAT_TIMEOUT`, for the same device and turn, within 24 hours. Recovered timing is `DEGRADED`.
- `INTEGRATION_EVENTS_ENABLED=false` returns retryable 503 after device authentication and does not acknowledge or mutate the event.

## Plugin delivery

- Locally persist before attempting network delivery.
- Queue records have stable event IDs and device-monotonic sequence numbers.
- One worker delivers FIFO with single-flight semantics.
- Retry network errors, 408, 429, and 5xx. Honor `Retry-After`; otherwise use exponential backoff with full jitter.
- Stop automatic retry on 401/403 and require device reconnection.
- Active queue limits: 10,000 records, 10 MiB, and 48 hours. Expired heartbeats are removed before more valuable lifecycle events.
- Permanent failures and corrupt records go to a 7-day dead-letter store with a privacy-safe reason.
- Delivery failure must never block Codex work. Manual web sessions remain the fallback.

## Quests and attempts

- Catalog endpoints expose only currently published versions and the current user's latest attempt/completion status.
- Catalog/detail never expose questions, options, correct answers, drafts, or internal grading fields.
- Starting an attempt requires an active AI session and pins quest ID/version/content for the attempt lifetime.
- Attempt states: `IN_PROGRESS`, `SUBMITTED`, `COMPLETED`, `FAILED`, `EXPIRED`.
- Answer replacement is atomic and validates ownership, question membership, option membership, and completeness bounds.
- Refresh restores the server-owned attempt and selected options.
- Submission locks the attempt/session rows, grades on the server, and is idempotent under same or different keys.
- Score is `floor(correct answers * 100 / total questions)`.
- A terminal AI session allows submission through exactly five minutes after its end time.
- Failed or expired attempts may retry only when the pinned quest policy allows it. A passed version cannot retry.
- Correct-answer review remains `null` in the beta response.

## Point ledger

- The first pass awards the quest's pinned reward snapshot, currently 100P.
- Grading, attempt completion, and ledger insertion occur in one database transaction.
- Database uniqueness enforces one reward per user + quest version and one reward per attempt.
- Failure to insert the ledger entry rolls back grading and attempt completion.
- The ledger is append-only. Balance is derived from owned ledger entries.
- `QUEST_REWARDS_ENABLED=false` blocks submission before grading begins.

## Statistics

- The user's saved IANA time zone defines today/week/month/custom boundaries.
- Boundaries are computed by PostgreSQL and represented as half-open UTC intervals.
- DST days may contain 23 or 25 hours; do not assume 24-hour local days.
- One request fixes a single database/server time for all aggregates and pagination.
- Active sessions contribute only through the request's `asOf` time.
- `DEGRADED` sessions are counted separately so recovered low-quality timing is visible.
- Quest count means first passes in the period. Point totals come only from ledger entries in the period.

## Security and privacy

- Forbidden data: prompt, AI response, code, diff, file/workspace path, transcript, tool input/output, raw hook payload, raw tokens, cookies, OAuth codes, and link codes.
- The API accepts one exact credentialed CORS origin. Production callback, redirects, and CORS origin must use HTTPS and compatible hosts.
- Request logs contain environment, service version, method, route template, status, latency, request ID, and safe error code only.
- Rate limits are PostgreSQL-backed so all API instances share buckets.
- Ownership filters belong in SQL conditions, not only controller checks.
- JSON payload size is 16 KiB. A turn may persist at most 500 integration events.

## Database and migrations

- Migrations are ordered, checked-in TypeScript files under `server/src/database/migrations/`.
- Never rely on ORM synchronize in production.
- A migration runner owns a PostgreSQL advisory lock and readiness fails while migrations are pending.
- Use expand → compatible deploy/backfill → contract for breaking schema changes.
- Production incident recovery rolls application images back only when the previous app is schema-compatible. Database changes roll forward.

## Deployment and pilot

- The primary product runtime is a developer-owned local clone. `npm run dev:local` starts local PostgreSQL, applies migrations and seed data, starts API and web, and verifies readiness.
- The local Codex plugin defaults to `http://localhost:3000/api/v1`; the developer keeps the integrated local process running while using the product.
- Hosted staging/production is optional and is not required for the local-first product path.
- Build API and web once from one commit, publish digest-pinned images, verify in staging, then promote the same digests to production.
- Deploy order: backup evidence → one-shot migration → API readiness → web → HTTPS/CORS/OAuth/SPA smoke.
- Pilot hard-stop events: forbidden-data exposure, auth/ownership bypass, duplicate point award, or unrecoverable data loss.
- Final pilot gate: at least 10 full-flow users, 7 days, 100 eligible automatic sessions, detection ≥95%, reflection p95 ≤5s, zero unrecoverable loss, zero duplicate sessions/points, API 5xx <1%.
- Retaining optional deployment tooling does not satisfy the pilot gate; task 20 remains incomplete without real external evidence.
