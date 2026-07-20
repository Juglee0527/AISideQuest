# AI Documentation Entry Point

This directory is the canonical technical context for AI-assisted development.

The compact entry-point documents (`README`, `CURRENT_STATE`, `CODE_MAP`, `API_CONTRACTS`, and `DOMAIN_CONTRACTS`) are maintained in English for efficient model context. Pre-existing Korean design records remain here as detailed references so no implementation rationale is lost.

## Read first

Read documents in this order before changing code:

1. [`CURRENT_STATE.md`](./CURRENT_STATE.md) — shipped scope, unfinished external work, verified test counts.
2. [`CODE_MAP.md`](./CODE_MAP.md) — ownership boundaries and where each behavior lives.
3. [`API_CONTRACTS.md`](./API_CONTRACTS.md) — endpoint inventory and cross-cutting request rules.
4. [`DOMAIN_CONTRACTS.md`](./DOMAIN_CONTRACTS.md) — compact English auth, session, queue, quest, reward, statistics, security, database, and deployment invariants.
5. Use the longer detailed reference related to the task when an edge case needs more context:
   - authentication: [`AUTHENTICATION.md`](./AUTHENTICATION.md)
   - sessions and event recovery: [`SESSION_STATE_AND_DATA_FLOW.md`](./SESSION_STATE_AND_DATA_FLOW.md)
   - database: [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)
   - security and privacy: [`SECURITY_AND_PRIVACY.md`](./SECURITY_AND_PRIVACY.md)
   - planned Discover product and privacy contract: [`DISCOVER_CONTRACT.md`](./DISCOVER_CONTRACT.md)
   - operations: [`OPERATIONS_RUNBOOK.md`](./OPERATIONS_RUNBOOK.md)
   - deployment and pilot: [`DEPLOYMENT_AND_PILOT.md`](./DEPLOYMENT_AND_PILOT.md)
6. Use [`PROJECT_SPEC.md`](./PROJECT_SPEC.md), [`BETA_IMPLEMENTATION_PLAN.md`](./BETA_IMPLEMENTATION_PLAN.md), [`../Discover_개발_계획.md`](../Discover_개발_계획.md), and [`IMPLEMENTATION_PROGRESS_SUMMARY.md`](./IMPLEMENTATION_PROGRESS_SUMMARY.md) only for product rationale, ordered implementation scope, and historical decisions.

## Source-of-truth order

When documentation conflicts, use this priority:

1. database constraints and migrations;
2. server types, DTOs, guards, and services;
3. automated tests;
4. `CURRENT_STATE.md` and domain contract documents;
5. implementation plans and historical summaries.

Do not silently change code to match an old plan. Confirm whether the code or the plan represents the intended current behavior, then update both the implementation and the canonical document in the same change.

## Non-negotiable invariants

- Never collect or log prompts, AI responses, source code, diffs, local paths, transcripts, or raw hook payloads.
- Browser mutations require a valid authenticated session and CSRF protection. Device events use device-token authentication.
- Mutation idempotency is enforced with request hashes, stored responses, row/advisory locks, and database uniqueness where applicable.
- Different hashed Codex session keys may run concurrently. A user may have at most one active manual fallback session and one active turn per hashed Codex session key.
- Automatic sessions expire after 120 seconds without valid activity. Pure manual sessions expire after 12 hours.
- A late `Stop` may recover only a same-device, same-turn session abandoned by heartbeat timeout within 24 hours.
- Quiz answers are graded only on the server. Correct-answer metadata never reaches the browser.
- The first passing attempt awards 100P at most once per user and quest version, in the same transaction as grading.
- Disabling quest rewards blocks submission before grading; it must never create a passed attempt without points.
- Production schema changes roll forward. Do not use destructive down migrations during incident response.
- Task 20 is not fully complete until real staging/production verification and the documented 10-user, 7-day pilot are finished.

## Documentation maintenance protocol

Every behavioral code change must include the relevant documentation update:

| Change | Update |
|---|---|
| endpoint, DTO, auth, CSRF, rate limit | `API_CONTRACTS.md` and `SECURITY_AND_PRIVACY.md` |
| session state, timeout, event behavior | `SESSION_STATE_AND_DATA_FLOW.md` |
| table, constraint, index, migration | `DATABASE_SCHEMA.md` |
| environment variable, health, metrics, alerts | `CURRENT_STATE.md` and `OPERATIONS_RUNBOOK.md` |
| deploy, rollback, image, pilot gate | `DEPLOYMENT_AND_PILOT.md` |
| Discover source, reward, cache, analytics, release rule | `DISCOVER_CONTRACT.md` and `../Discover_개발_계획.md` |
| user-visible workflow | the matching Korean document in `docs/` |

Keep human documentation task-oriented and concise. Keep AI documentation explicit about invariants, edge cases, paths, commands, and completion conditions.
