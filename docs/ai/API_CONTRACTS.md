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
| `GET /sessions/active` | browser session | all current active sessions, newest first; returns an empty array when none |
| `GET /sessions` | browser session | owned cursor history |
| `POST /integration-events` | device token + idempotency | apply privacy-safe Codex lifecycle event and optional sanitized display labels |
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
| `GET /discover` | browser session; no active AI session required | validated category/source filter, empty item baseline, cursor contract, and safe per-source status |
| `GET /discover/sources` | browser session; no active AI session required | safe source catalog and availability metadata |

For exact DTO bounds, rate limits, and ownership rules, use [`SECURITY_AND_PRIVACY.md`](./SECURITY_AND_PRIVACY.md). For session event semantics, use [`SESSION_STATE_AND_DATA_FLOW.md`](./SESSION_STATE_AND_DATA_FLOW.md).

`workspaceLabel` is optional turn metadata produced locally from only the final folder segment. It is limited to 64 letters, numbers, spaces, `.`, `_`, and `-`; separators and full paths are rejected. `operationLabel` is optional only for `PreToolUse`, `PermissionRequest`, and `PostToolUse`, and must be one of the server allowlisted canonical labels such as `npm test`, `git status`, `Gradle test`, `코드 변경`, or `기타 명령`. Raw `cwd`, tool input, command arguments, environment variables, and tool output remain unknown fields and are rejected.

## Discover read contract

Tasks 22-26 ship the authenticated read contract, common model, safe adapter/cache boundary, Hacker News, Remotive, and the `/discover` browser screen. Both sources are `enabled: true`; an uncached list request performs a bounded refresh and then returns `FRESH`, bounded fallback may return `STALE`, and an unavailable source returns no items. The other planned sources remain disabled.

`GET /discover` query:

| Field | Contract |
|---|---|
| `category` | optional `EARNING`, `NEWS`, or `COMMUNITY` |
| `source` | optional known source enum |
| `limit` | integer 1-50, default 20 |
| `cursor` | optional opaque base64url cursor, maximum 1,000 characters |

Unknown fields and invalid enum, limit, or cursor values return the common `400 VALIDATION_ERROR`. A cursor is versioned and binds the future stable order tuple `(sortAt DESC, source ASC, id ASC)`, where `sortAt` is `publishedAt ?? fetchedAt`. Clients must not construct or edit it.

Successful `GET /discover` data:

```json
{
  "items": [],
  "nextCursor": null,
  "savedItems": [],
  "sources": [
    {
      "source": "REMOTIVE",
      "displayName": "Remotive",
      "categories": ["EARNING"],
      "enabled": true,
      "status": "UNAVAILABLE",
      "fetchedAt": null
    }
  ]
}
```

`GET /discover/sources` returns `{ "sources": [...] }` for `HACKER_NEWS`, `REMOTIVE`, `DEV`, `STACK_EXCHANGE`, `GITHUB`, and `ALGORA`. `enabled` means an adapter is active. `status` is `FRESH`, `STALE`, or `UNAVAILABLE`; `FRESH` and `STALE` require a successful ISO8601 `fetchedAt`. No raw upstream error is exposed.

Every future `DiscoverItem` has a stable namespaced ID (`SOURCE:base64url-safe-external-key`), source, category, kind, bounded plain-text title/nullable summary/tags, nullable reward, nullable compensation, validated HTTPS original URL, attribution, nullable `publishedAt`, and required `fetchedAt`.

Registered adapters resolve independently. A fresh cache is returned without an upstream call; a stale or missing cache may trigger one per-source locked refresh. Refresh failure returns cache data only within that adapter's maximum stale age, otherwise `UNAVAILABLE`. One source failure does not change the HTTP success of another source, and raw upstream error details are never returned.

## Discover saved-item contract

All endpoints require the authenticated browser session and never require an active AI session.

| Endpoint | Contract |
|---|---|
| `GET /discover/saved-items?limit=20&cursor=...` | Own snapshots only; limit 1-50; opaque stable cursor |
| `POST /discover/saved-items` | Body `{ "itemId": "SOURCE:key" }`; CSRF + UUID `Idempotency-Key` |
| `DELETE /discover/saved-items/:savedItemId` | Empty body; CSRF + UUID `Idempotency-Key`; ownership-scoped |

Save returns `{ "created": boolean, "savedItem": { "id", "item", "savedAt" } }`. The server resolves the ID from its normalized source cache and never accepts a browser-supplied title, URL, reward, or other snapshot field. Duplicate saves reuse the unique `(user, item)` row and return `created: false`.

Delete returns `{ "deleted": boolean, "savedItemId": "uuid" }`. Missing, already deleted, and another user's IDs return `deleted: false`. Saved list responses are `{ "items": [...], "nextCursor": string | null }` and remain available without the source cache.

Hacker News maps Top and Show to `NEWS/ARTICLE`, Ask to `COMMUNITY/DISCUSSION`, and Jobs to `EARNING/PAID_JOB`. Deleted or incomplete items are omitted. Missing or non-HTTPS story URLs use the canonical HTTPS Hacker News discussion URL. Hacker News compensation and rewards are never inferred.

Remotive maps validated Software Development jobs to `EARNING/PAID_JOB`. `originalUrl` is the direct source-provided Remotive HTTPS detail URL and attribution is always `Remotive`. Salary is source-provided compensation text, never a parsed cash reward; missing salary is represented by `{ provided: false, text: null }`. Employment type is a fixed tag and location remains bounded plain-text context.

- `EARNING`: `PAID_JOB` or `CASH_BOUNTY`.
- `NEWS`: `ARTICLE`.
- `COMMUNITY`: `DISCUSSION`, `REPUTATION_BOUNTY`, or `OSS_TASK`.
- A cash reward is `{ type: "CASH_BOUNTY", amountMinor: positive safe integer, currency: ISO 4217 uppercase code }`.
- A reputation reward is `{ type: "REPUTATION_BOUNTY", amount: positive safe integer }` and has no currency.
- Only `PAID_JOB` carries compensation: either `{ provided: false, text: null }` or sanitized source-provided text. Compensation is never a reward.
- Kinds without a matching verified reward return `reward: null`; non-job items return `compensation: null`.
