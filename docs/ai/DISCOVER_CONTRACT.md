# Discover Product Contract

Status: task 21 complete; tasks 22-33 are not implemented.  
Contract date: 2026-07-20

This document is the canonical product, privacy, and release contract for the
planned Discover expansion. It defines decisions that later API, database,
adapter, UI, and pilot work must preserve. It does not describe shipped
endpoints or screens.

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
  72 hours. This bounds normal requests to no more than four refreshes per day
  per shared deployment.
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

## Product analytics and privacy

Discover remains functional without behavioral analytics. Tasks 22-26 do not
implicitly authorize collecting visits or clicks. Before the task 33 pilot,
task 32 may add the following minimal events under the rules below:

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

Task 27 saved-item snapshots and task 28 explicitly selected interests are also
owned user data. They must be included in export and deletion, excluded from
operational logs and metric labels, and retained only while the account or the
specific record remains.

## Release terminology and gates

- Task 21 complete means the product contract is fixed; it does not ship a
  Discover feature.
- Tasks 22-26 complete mean `Discover MVP implementation complete` and produce a
  release candidate, not automatic production release.
- A Discover MVP release additionally requires the repository test gates, real
  Hacker News and Remotive smoke evidence, source attribution and request-rate
  checks, desktop/mobile and accessibility checks, partial/total failure checks,
  and a forbidden-data review.
- A local-first release does not complete task 20. Task 20 still requires its
  separately documented real staging/production and 10-user, 7-day evidence.
- Task 33 is the Discover product pilot and cannot be declared complete until
  task 32 analytics, metric definitions, retention, export, and deletion are
  implemented and verified.

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
