# Discover Product Contract

Status: tasks 21-32 complete; task 33 execution tooling is implemented, with the real seven-day pilot pending.
Contract date: 2026-07-23

This document is the canonical product, privacy, and release contract for the
Discover expansion. It defines decisions that later database, adapter, UI, and
pilot work must preserve. Tasks 24-25 have enabled Hacker News and Remotive
through the adapter, cache, stale fallback, and source health boundaries. The
Task 26 adds the authenticated Discover screen, task 27 adds user-owned saved
items, and task 28 adds explicit-interest ordering without behavioral analytics.

## Common model and API baseline

- `GET /api/v1/discover` accepts optional `category`, `source`, opaque `cursor`,
  and `limit` from 1 to 50 (default 20).
- `GET /api/v1/discover/sources` returns the safe source catalog.
- Both endpoints require a browser session and never require an active AI
  session.
- List data is `{ items, nextCursor, sources, savedItems, recommendations }`; source-list data is
  `{ sources }`. The common API envelope remains unchanged.
- Source snapshots contain source, display name, categories, `enabled`, status,
  and nullable successful fetch time. Status is `FRESH`, `STALE`, or
  `UNAVAILABLE`; no raw upstream error is returned.
- The model separates category from kind and uses discriminated cash and
  reputation reward shapes. Compensation is a separate job-only union.
- Items use a stable namespaced ID, a validated HTTPS original URL, bounded
  normalized text, nullable publication time, required fetch time, and nullable
  source-provided engagement metadata.
- With no selected interests, item order remains `(publishedAt ?? fetchedAt)
  DESC, source ASC, id ASC`. With interests, the deterministic tuple is interest
  match count, relative recency band, source engagement, clear reward or salary,
  then the chronological tuple. The versioned cursor binds the current interest
  hash and ranking tuple and remains opaque to clients.
- A source without a registered adapter remains `enabled: false` and
  `UNAVAILABLE`. Hacker News, Remotive, DEV, and Stack Exchange are registered
  unconditionally. GitHub is registered only when its separate server token and
  at least one approved organization or repository scope are configured
  together. Task 31 reached a documented Algora NO-GO decision, so Algora stays
  disabled and no Algora adapter is registered.

## Adapter infrastructure baseline

- A source is enabled only when a server-side `DiscoverSourceAdapter` is
  registered. Each adapter owns its source identity, categories, display name,
  fresh TTL, maximum stale age, and normalized item fetch.
- The shared HTTP client accepts only HTTPS URLs whose exact hostname is in the
  adapter-provided allowlist. Credentials, non-default ports, and redirects are
  rejected before response parsing.
- Requests time out, perform at most three configured attempts, accept bounded
  JSON response bodies only, and retry only transient network, timeout, rate
  limit, or upstream failures.
- Normalization enforces namespaced identity, category/kind/reward/compensation
  consistency, bounded plain text, HTTPS display URLs, and canonical dates
  before a cache write.
- PostgreSQL cache refreshes use a per-source transaction advisory lock and an
  in-process single-flight. A losing instance serves bounded stale data or an
  unavailable status instead of multiplying upstream calls.
- Cache/fetch counters, source freshness and item-count gauges, bounded fetch
  latency histograms, the code-managed dashboard, and warning/critical source
  alerts use only fixed source, result, and failure-reason labels.

## Source expansion contract

- Task 29 is delivered as independently verified `29A DEV` and `29B Stack
  Overflow`. A user interest never causes an upstream request. Every source
  refresh populates the shared cache, and task 28 interests only rank the
  already-normalized result.
- DEV uses one public `GET https://dev.to/api/articles?per_page=30` request per
  shared refresh. It sends `Accept: application/vnd.forem.api-v1+json`, never
  sends an API key, has a 30-minute fresh TTL and 24-hour maximum stale age,
  and performs no source-level retry. DEV articles are attributed to `DEV
  Community`; title, description, tags, reading time, positive reactions,
  publication time, and a direct `https://dev.to/` article URL are the only
  parsed fields.
- DEV reading time is a nullable positive integer in minutes. Positive reaction
  count is nullable `REACTIONS` engagement. Raw article HTML, Markdown, author
  profile data, and response bodies are neither cached nor logged.
- Stack Overflow uses fixed Stack Exchange API v2.3 methods, at most one
  30-question page for featured
  and unanswered questions per refresh, a 15-minute fresh TTL, a 24-hour
  maximum stale age, and no user-interest query. It must parse the common
  wrapper even on HTTP success, honor method-level `backoff` in a shared request
  gate, and never repeat a semantically identical request more often than once
  per minute. `quota_remaining: 0` fails the current refresh so the shared cache
  falls back to bounded stale data, then blocks new requests until the next UTC
  day. `has_more` never expands the one-page boundary. A Stack Overflow bounty
  is reputation only; unanswered questions without a bounty are discussions.
  The adapter caches no owner, body, HTML, Markdown, or raw wrapper data and
  accepts only matching `https://stackoverflow.com/questions/...` links.
- Task 30 uses `GITHUB_DISCOVER_TOKEN`, a server-only fine-grained token kept
  separate from login OAuth, plus explicit `GITHUB_DISCOVER_ORGANIZATIONS`
  and/or `GITHUB_DISCOVER_REPOSITORIES` allowlists. All three settings remain
  optional as a group; without a token and at least one scope, GitHub is
  disabled. A configured refresh performs one lexical Search Issues request,
  page 1 with 30 results, sorted by latest update, and a fixed
  `is:issue is:open no:assignee` query for `good first issue`, `help wanted`, or
  `documentation` labels. Results must also have no `pull_request`, be open and
  unassigned, use a direct matching `github.com/<owner>/<repo>/issues/<number>`
  URL, and remain inside the configured allowlist. They normalize to
  `COMMUNITY/OSS_TASK`; labels never imply cash, salary, reputation, or
  AISideQuest points. Raw body, user, assignee, repository payload, and API URLs
  are discarded. The fresh TTL is 30 minutes and maximum stale age is 24 hours.
  Requests use GitHub REST API version `2026-03-10`, the separate search bucket,
  no source retry, and block after `403`/`429` according to `Retry-After`, then
  `X-RateLimit-Remaining`/`X-RateLimit-Reset`, with a one-minute fallback.
- Task 31 completed on 2026-07-22 with the documented
  [`Algora NO-GO decision`](./operations/2026-07-22-algora-research.md). The
  official SDK lists bounties only for a previously known organization, no
  supported public global-discovery or organization-enumeration route and no
  provider rate-limit contract were found, and the service terms do not permit
  scraping as a fallback. No adapter, schema, or UI change is authorized.

## Hacker News adapter

- The server fetches only `https://hacker-news.firebaseio.com/v0/` feed and
  item endpoints. It never follows an upstream redirect.
- One refresh reads Top, Show, Ask, and Jobs, taking at most 12 IDs per feed.
  Duplicate IDs are fetched once; classification precedence is Jobs, Ask, Show,
  then Top. Logical calls are capped at 4 feed plus 48 item requests, item
  concurrency is capped at 8, and only feed requests may retry once.
- Top and Show become `NEWS/ARTICLE`, Ask becomes `COMMUNITY/DISCUSSION`, and
  Jobs become `EARNING/PAID_JOB`. Jobs never infer salary and use explicit
  unavailable compensation.
- Deleted, dead, null, wrong-type, mismatched-ID, missing-title, or invalid-time
  items are skipped independently. HTML title/text is converted to bounded
  plain text.
- A valid HTTPS story URL is preserved. Missing, empty, malformed, non-HTTPS,
  or credential-bearing URLs fall back to the canonical HTTPS Hacker News
  discussion link.
- A small number of item-detail failures may produce a partial fresh result.
  When more than 25 percent of requested details fail, the refresh fails so the
  previous cache is served as `STALE` instead of being replaced broadly.

## Remotive adapter

- The server calls only `https://remotive.com/api/remote-jobs` with
  `category=software-dev` and `limit=30`. One shared refresh performs one HTTP
  attempt with no source-level retry.
- The fresh TTL is 6 hours and maximum stale age is 72 hours, keeping normal
  traffic at no more than four shared refreshes per day as requested by the
  public API policy.
- Only positive numeric IDs, Software Development category, bounded title,
  valid publication time, and direct HTTPS `remotive.com` detail URLs become
  items. Duplicate IDs keep their first feed occurrence.
- All items are `EARNING/PAID_JOB`, attributed to `Remotive`, and preserve the
  source URL. Full-time, contract, freelance, part-time, and internship are
  fixed tags; unknown job types are not inferred.
- Company, candidate location, and HTML description are converted to bounded
  plain-text summary. Salary is preserved only as sanitized source-provided
  compensation text. Missing salary remains explicitly unavailable even when
  the description contains currency-like text.
- Isolated invalid jobs are skipped. An entirely invalid result or at least
  three invalid jobs exceeding 25 percent fails the refresh so stale cache is
  not broadly replaced after an upstream schema change.

## Product boundary

- Discover helps developers find external job and contract opportunities,
  verified bounties, development articles, and community discussions.
- AISideQuest is an index and outbound-link surface. It is not the employer,
  contracting party, bounty payer, payment intermediary, or guarantor.
- An opportunity may be unavailable, changed, misleading, or subject to the
  external provider's own eligibility and payment rules. The original provider
  remains authoritative.
- Discover never submits applications, creates external accounts, stores
  external payment details, or performs work on the user's behalf.
- External clicks and saves never award AISideQuest points.

## Access decision

- The planned `/discover` page and browser APIs require the existing GitHub
  authenticated browser session.
- An active AI session is not required. Discover remains usable before, during,
  and after a Codex turn.
- Authentication exists for the product's existing ownership boundary and
  future saved items. It must not be used to collect email addresses, subscribe
  users to marketing, or hide a provider's job detail behind an additional
  AISideQuest lead-generation form.
- The application continues to discard the GitHub OAuth access token after
  identity resolution and does not request or store GitHub email addresses.
- Before any hosted public launch, source terms must be rechecked. Remotive
  cards must always identify Remotive and link directly to the URL supplied by
  Remotive; the public feed must not be presented as a signup-acquisition tool.

## Value and reward classification

| Classification | Meaning | Display rule |
|---|---|---|
| AISideQuest points | Non-cash service points from AISideQuest quests | Separate from Discover; never inferred from an external item |
| Job or contract opportunity | A possible paid role or contract | Never described as guaranteed income or employment |
| Compensation | Salary text supplied by the job source | Preserve as sanitized source-provided text; do not infer missing amount, currency, or period |
| Cash bounty | External cash reward | Show only when the provider supplies amount, currency, and active status |
| Reputation bounty | Non-cash reputation on an external service | Never label as cash, salary, or AISideQuest points |
| Open-source contribution | Contribution or portfolio opportunity | Never infer payment from a title or label such as `bounty` |
| Development information | Article, release, or technical case | No reward claim |
| Community discussion | Question or discussion topic | No reward claim |

`compensation` and `reward` are separate concepts in the future common model.
An optional free-form salary such as a Remotive salary range is compensation,
not a verified cash bounty.

## Source and link boundary

- Only the NestJS server may fetch source APIs.
- Outbound fetch destinations use a fixed per-source HTTPS host allowlist.
  Redirects are disabled or revalidated against that allowlist at every hop.
- Users cannot provide a URL for the server to fetch.
- Article and discussion links shown to users are not server fetch targets.
  They must use HTTPS, pass URL parsing and control-character checks, and open as
  external links with `noopener` and `noreferrer`.
- A source adapter parses only the bounded fields it needs. Raw response bodies,
  HTML descriptions, complete URLs, and upstream error payloads are excluded
  from application logs and metric labels.
- Titles, summaries, tags, attribution, compensation, and reward fields are
  normalized to bounded plain text before caching or returning them.

## Cache and external-data retention

- Raw upstream payloads and HTML are processed in memory and discarded after
  normalization. They are never persisted as cache, diagnostics, or history.
- Only normalized Discover items and low-cardinality source freshness metadata
  may be stored in the shared PostgreSQL cache.
- Initial Hacker News defaults: fresh for 10 minutes, stale fallback for at most
  24 hours.
- Initial Remotive defaults: fresh for 6 hours, stale fallback for at most
  72 hours. Each refresh performs one HTTP attempt with no source-level retry,
  keeping the normal shared-deployment path within four requests per day.
- A future source must define its fresh TTL and maximum stale age before it is
  enabled. `STALE` data is labeled as such; data older than the source's maximum
  stale age is never returned as available.
- Normalized cache rows are replaced or purged no later than 7 days after their
  last successful source refresh. Saved-item snapshots introduced by task 27
  are user-owned data, not source cache, and follow the account lifecycle.
- Cache refresh is shared across API instances and uses single-flight or an
  equivalent lock so concurrent misses do not multiply upstream calls.

## Availability contract

- One source failure must not fail another source or an existing AISideQuest
  feature.
- A Discover list response will carry a safe status for every requested source:
  `FRESH`, `STALE`, or `UNAVAILABLE`, plus a nullable successful fetch time.
- Upstream hostnames, raw status bodies, stack traces, and internal retry details
  are not returned to the browser.
- External source availability does not participate in core liveness or database
  readiness. It is a degraded feature state, not a reason to mark the whole
  application unhealthy.

## Screen contract

- `/discover` appears in desktop and mobile navigation and requires the existing
  authenticated browser session, not an active AI session.
- The three accessible tabs request `EARNING`, `NEWS`, and `COMMUNITY`
  independently. Tab changes replace the current page; opaque-cursor pagination
  appends de-duplicated items without constructing or editing a cursor.
- Cards show kind, attribution, normalized title and summary, tags, publication
  time, explicit compensation or verified reward information, and a clear
  external original-link action. External links use a new context with
  `noopener noreferrer`.
- Initial loading, authenticated-session waiting, healthy empty, request error,
  total source unavailability, partial source failure, stale data, pagination
  loading, and pagination error are distinct states. A later-page error preserves
  the already loaded items.
- Disabled future sources are not reported as failures. `STALE` and enabled
  `UNAVAILABLE` sources are explained without exposing upstream error details.
- The screen records only the Task 32 privacy-bounded view, tab, and outbound
  click events. It does not infer compensation or claim that an opportunity,
  reward, or availability is guaranteed.

## Saved-item contract

- `GET /api/v1/discover/saved-items` returns only the authenticated user's saved
  normalized snapshots with an opaque `(savedAt DESC, id DESC)` cursor.
- `POST /api/v1/discover/saved-items` accepts only a normalized `itemId` already
  present in the server cache. It requires CSRF and a UUID idempotency key; the
  server stores its own validated snapshot rather than trusting card fields from
  the browser.
- `DELETE /api/v1/discover/saved-items/:savedItemId` requires CSRF and a UUID
  idempotency key. The ownership predicate is part of the delete statement;
  missing, already deleted, or another user's IDs return `deleted: false`.
- `(user_id, source_item_id)` is unique. A duplicate save returns the existing
  row with `created: false`, and an exact idempotent replay returns the original
  response.
- Saved snapshots remain readable when the external source and shared source
  cache are unavailable. They are included in current user export schema version 4 and
  deleted in the account-deletion transaction.
- The `/discover` screen provides separate explore and saved views. Save and
  remove failures remain local to the action and do not hide already loaded
  cards.

## Explicit-interest personalization contract

- `GET /api/v1/discover/interests` returns the authenticated user's selected
  tags. `PUT /api/v1/discover/interests` replaces the full set and requires CSRF
  plus a UUID idempotency key.
- The server accepts at most 10 unique tags from the fixed 20-tag allowlist. An
  empty set removes the preference row and restores the exact chronological
  default.
- Ranking uses only normalized external item tags and the explicitly selected
  tags. Hacker News exposes its non-negative source score; Remotive currently
  has no engagement value. Title and summary keyword matching only adds fixed
  canonical tags and does not use an LLM.
- Relative recency bands are measured from the newest item in the resolved set:
  at most 1 day, 7 days, 30 days, or older. This avoids request-time-dependent
  ordering, so equal items and interests always produce the same order.
- Recommendation reasons are limited to interest match, recent item,
  source-provided engagement, and clear reward or salary information. They do
  not claim relevance beyond these observable factors.
- Updating interests invalidates an older Discover cursor rather than mixing two
  ranking configurations. Interest rows are included in user export schema
  version 3 and deleted with the account.
- Prompts, AI responses, source code, diffs, transcripts, raw commands, tool
  input/output, workspace labels, and local paths are never personalization
  inputs.

## Product analytics and privacy

Discover remains functional if analytics recording fails. Task 32 implements
the following minimal events under the rules below:

- allowed event names: `DISCOVER_VIEW`, `TAB_VIEW`, `OUTBOUND_CLICK`, `SAVE`;
- allowed dimensions: source and product category from fixed allowlists;
- forbidden fields: item ID, title, summary, tags, original URL, search text,
  selected-interest tags, prompt, AI response, code, diff, transcript, raw
  command, operation label, workspace label, and local path;
- the authenticated user ID may be stored in the owned analytics row only to
  calculate unique and repeat usage; it is forbidden in logs and metric labels;
- owned analytics rows expire after 90 days and must be included in account
  export and primary account deletion;
- Prometheus metrics expose aggregates only and never a user or item identifier.
- Client event writes require browser authentication, CSRF, and an idempotency
  key. `SAVE` cannot be submitted through the analytics endpoint; it is written
  by the saved-item transaction only for the first `created: true` result.
- The operational dashboard and aggregate metrics use a rolling 30-day window;
  owned rows expire after 90 days. Pilot definitions and UTC de-duplication SQL
  are code-managed in `ops/discover-pilot-metrics.sql`.

Task 27 saved-item snapshots and task 28 explicitly selected interests are owned
user data. They are included in export and deletion, excluded from operational
logs, metric labels, and analytics, and retained only while the account or the
specific record remains.

## Release terminology and gates

- Task 21 complete means the product contract is fixed. Task 22 adds the common
  read contract but does not ship external Discover content or a screen.
- Tasks 22-26 complete mean `Discover MVP implementation complete` and produce a
  release candidate, not automatic production release.
- A Discover MVP release additionally requires the repository test gates, real
  Hacker News and Remotive smoke evidence, source attribution and request-rate
  checks, desktop/mobile and accessibility checks, partial/total failure checks,
  and a forbidden-data review.
- Task 26 local UI evidence covers unauthenticated desktop/mobile layout and
  keyboard tab semantics. An authenticated real-card browser check and a full
  accessibility review remain release evidence, not implementation blockers.
- A local-first release does not complete task 20. Task 20 still requires its
  separately documented real staging/production and 10-user, 7-day evidence.
- Task 33 is the Discover product pilot and cannot be declared complete until
  task 32 analytics, metric definitions, retention, export, and deletion are
  implemented and verified. Repository readiness is not pilot evidence.
- `TAB_VIEW` is emitted only for an explicit change to a different category;
  initial category display emits `DISCOVER_VIEW` but not `TAB_VIEW`.
- The executable aggregate query accepts exact UTC-midnight boundaries seven
  days apart and returns counts, de-duplicated rates, category/source event
  breakdowns, UTC one-hour aggregate buckets for operational comparison, and no
  user or item identifier.
- Source empty-result rate uses successful normalized refreshes as its
  denominator. Source failure rate uses refresh attempts as its denominator.
- `npm run discover:pilot:collect` reads the aggregate query with the database
  URL supplied only through the environment. `npm run discover:pilot:evaluate`
  requires dashboard/alert/privacy preflight evidence and sample/decision plans
  approved before the observation starts.
- The evaluator never emits a success decision. It returns `NOT_READY`,
  `INVALID_OBSERVATION`, `EXTEND_PILOT`, or `READY_FOR_PRODUCT_DECISION`, then
  applies the pre-approved thresholds to the four next-scope principles.

## Explicitly excluded

- AISideQuest cash payment, escrow, withdrawal, currency conversion, or tax
  handling;
- automatic job or bounty application;
- external account credentials or payment information;
- first-party posts, comments, or messaging;
- LLM summaries or recommendations based on external content;
- recommendation from prompts, AI responses, source code, diffs, transcripts,
  raw commands, tool input/output, or local paths;
- points for viewing, clicking, saving, applying to, or completing an external
  item.
