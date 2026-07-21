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
- Hooks always prefer the canonical user-local `device.json`. A legacy copy under `PLUGIN_DATA` is read only when the canonical credential is absent, so a stale plugin-version credential cannot shadow a newer connection.
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
| `Heartbeat` | activity only; may carry bounded queue diagnostics; emitted only while the recorded Codex hook host is alive, with a 120-second real-hook fallback lease when no host PID is available |
| `Stop` | transitions to `COMPLETED` with `HOOK_STOP` |

- PostgreSQL permits different hashed Codex session keys to run concurrently, while allowing at most one active turn per hashed Codex session key and one active manual fallback session per user.
- A new turn supersedes only the previous active turn with the same hashed Codex session key.
- `GET /sessions/active` returns every active snapshot newest first. Home polls this collection and renders one read-only elapsed-time card per session; it never exposes start or end controls.
- Cards use a fragment of the server session ID and may show a locally sanitized final folder label plus a canonical operation label. Full paths, command arguments, environment variables, prompts, task titles, and completion percentages are not collected or inferred.
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
- Recognized queue formats from earlier plugin versions are migrated under the queue lock, rebased above the last acknowledged device sequence, and delivered in their original FIFO order. A compatible old record is never classified as corrupt.
- Permanent failures and corrupt records go to a 7-day dead-letter store with a privacy-safe reason.
- Delivery failure must never block Codex work. Manual web sessions remain the fallback.
- Before persistence or delivery, the plugin reduces `cwd` to a separator-free final folder label and maps tool input to a fixed operation allowlist. Raw paths, raw commands, arguments, and tool results never enter the event log or queue.

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

- Forbidden data: prompt, AI response, code, diff, full file/workspace path, raw command or arguments, transcript, tool input/output, raw hook payload, raw tokens, cookies, OAuth codes, and link codes. The only permitted display derivatives are the final-folder `workspaceLabel` and fixed-allowlist `operationLabel` produced locally before persistence.
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

## Discover expansion (Hacker News, Remotive, and screen enabled)

- Discover requires the existing GitHub-authenticated browser session but never an active AI session.
- `GET /discover` and `GET /discover/sources` are implemented with validated filters, an opaque versioned cursor contract, safe source status, and strict client parsing. Hacker News Top·Ask·Show·Jobs and Remotive Software Development jobs are enabled through bounded HTTP, normalized cache, single-flight and stale fallback.
- `/discover` provides accessible earning, news, and community tabs, cursor-based load-more, safe external links, and distinct loading, empty, stale, partial-failure, and total-failure states. Disabled future sources are not presented as failures, and a paging failure preserves loaded items.
- AISideQuest only indexes and links to external items. It does not guarantee employment, income, bounty payment, eligibility, or availability.
- AISideQuest points, source-provided job compensation, verified cash bounties, and reputation bounties are separate classifications. An external click or save never awards points.
- Only the server fetches fixed source API hosts. Display links are never used as server fetch targets, and raw upstream payloads or HTML are never persisted or logged.
- The shared cache stores normalized items only, applies source-specific fresh and maximum stale ages, and purges normalized cache rows within 7 days of their last successful refresh.
- Product analytics are not implicit in tasks 22-26. Before a Discover pilot, only fixed low-cardinality view/click/save events may be added; item details and selected interests remain forbidden, owned rows expire after 90 days, and export/deletion must include them.
- Completing tasks 22-26 produces a Discover release candidate. Real source smoke, attribution, failure, accessibility, and privacy evidence are still required for release, and none of this completes task 20.
- The full contract is [`DISCOVER_CONTRACT.md`](./DISCOVER_CONTRACT.md).
