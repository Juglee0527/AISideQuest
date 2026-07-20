# API Contracts

Base path: `/api/v1`

## Common protocol

- Success: `{ "data": ..., "meta": { "serverTime": ISO8601, "requestId": string } }`.
- Error: `{ "error": { "code": string, "message": string, "details"?: string[] }, "meta": ... }`.
- Every response includes `X-Request-ID`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.
- Browser credentials are accepted only from the exact configured CORS origin.
- Browser mutation endpoints require the authenticated cookie session and CSRF header unless explicitly documented otherwise.
- Device event endpoints use device bearer authentication, not browser cookies.
- Mutation idempotency keys are UUIDs. Event `Idempotency-Key` must equal the normalized `eventId`.
- Unknown DTO properties are rejected. JSON bodies are limited to 16 KiB.
- Pagination uses opaque stable cursors; clients must not construct or edit them.

## Endpoint inventory

| Method and path | Authentication | Purpose |
|---|---|---|
| `GET /health`, `/health/live` | public | process liveness |
| `GET /health/ready` | public | DB connectivity and zero pending migrations |
| `GET /health/metrics` | metrics bearer token | Prometheus metrics |
| `GET /auth/github` | public, rate-limited | begin GitHub OAuth with state + PKCE; optional same-origin `returnTo` |
| `GET /auth/github/callback` | OAuth state cookie | complete or cancel OAuth |
| `GET /auth/me` | browser session | current user |
| `PATCH /auth/me/time-zone` | session + CSRF | save validated IANA time zone |
| `POST /auth/logout` | session + CSRF | revoke current session |
| `POST /auth/me/export` | session + CSRF + recent auth | export owned data |
| `DELETE /auth/me` | session + CSRF + recent auth | delete account transactionally |
| `POST /device-link-requests` | public + idempotency + rate limit | create a 10-minute browser approval request from verifier/token hashes |
| `GET /device-link-requests/:id` | browser session | read safe pending request metadata |
| `POST /device-link-requests/:id/approve` | session + CSRF + idempotency | approve the request and bind its hash-only device credential |
| `POST /device-link-requests/:id/complete` | verifier proof + rate limit | poll pending state or finish local connection after approval |
| `POST /device-links` | session + CSRF + idempotency | recovery-only: create a 10-minute single-use link code |
| `POST /device-links/redeem` | link code + idempotency | recovery-only: issue device token once |
| `GET /devices` | browser session | list owned safe device metadata |
| `POST /devices/:id/rotation-links` | session + CSRF + ownership | begin token rotation |
| `POST /devices/:id/revoke` | session + CSRF + ownership | revoke device idempotently |
| `POST /sessions/manual` | session + CSRF + idempotency | create or reuse active manual session |
| `POST /sessions/:id/end` | session + CSRF + ownership + idempotency | complete/fail/cancel manual session |
| `GET /sessions/active` | browser session | current active session |
| `GET /sessions` | browser session | owned cursor history |
| `POST /integration-events` | device token + idempotency | apply privacy-safe Codex lifecycle event |
| `GET /quests` | browser session | published current-version catalog |
| `GET /quests/:code` | browser session | published metadata and recent user status |
| `POST /quests/:code/attempts` | session + CSRF + active AI session + idempotency | start pinned attempt |
| `GET /quest-attempts/:id` | session + ownership | resume attempt without answers |
| `PUT /quest-attempts/:id/answers` | session + CSRF + ownership | atomically replace selections |
| `POST /quest-attempts/:id/submissions` | session + CSRF + ownership + idempotency | grade and conditionally award points |
| `GET /points/balance` | browser session | owned balance |
| `GET /points/ledger` | browser session | owned immutable cursor history |
| `GET /stats/summary` | browser session | today/week/month/custom aggregate |
| `GET /stats/activity` | browser session | cursor-paginated mixed activity |

For exact DTO bounds, rate limits, and ownership rules, use [`SECURITY_AND_PRIVACY.md`](./SECURITY_AND_PRIVACY.md). For session event semantics, use [`SESSION_STATE_AND_DATA_FLOW.md`](./SESSION_STATE_AND_DATA_FLOW.md).
