# Algora source research and NO-GO decision

- Research date: 2026-07-22
- Decision: **NO-GO**
- Scope: Discover Task 31 only
- Product changes: none; no Algora adapter, database migration, or UI change

## Evidence reviewed

1. The official [Algora API reference](https://api.docs.algora.io/) documents bounty operations but does not document a public global bounty-discovery endpoint, an organization-directory endpoint, rate-limit headers, or a supported request budget.
2. The official [Algora TypeScript SDK](https://github.com/algora-io/sdk) calls `https://console.algora.io/api/trpc`. Its public bounty-list examples require an explicit `org` handle, and the embeddable board requires `data-bounty-org`. The SDK therefore supports listing for a previously known organization, not discovering the universe of eligible organizations.
3. The official [Algora Community page](https://algora.io/community) displays selected public bounties, but it is a product page rather than a documented, versioned API contract.
4. The current [Algora Terms of Service](https://algora.io/legal/terms) prohibit automated access for monitoring or copying and prohibit reusing service content without prior written permission. Scraping the Community page is therefore not an acceptable fallback.
5. Algora publicly markets USD rewards and, on its [Swift program page](https://algora.io/swift), payouts in 120 countries, but no stable country eligibility list or machine-readable availability contract was found. This is insufficient for product eligibility claims.

## Required decision fields

| Field | Finding |
|---|---|
| Public global discovery | Not documented |
| API host | Official SDK uses `https://console.algora.io/api/trpc` |
| Authentication | Public SDK list example shows no credential, but requires a known organization handle; authenticated management operations are not a global discovery path |
| Organization selection | No official organization enumeration route and no AISideQuest-approved organization allowlist |
| Allowlist renewal | Not defined because no allowlist owner or authoritative source exists |
| Attribution and reuse | No API-specific attribution grant found; site terms require prior written permission for automated copying or content reuse |
| Country support | Marketing states 120 countries, but no stable supported-country list or eligibility API was found |
| Currency | Official SDK types and product pages use USD for cash rewards |
| Page/request cap | SDK accepts a bounded organization list query, but no provider contract for a maximum page or request budget was found |
| Rate limit | No official rate-limit bucket, headers, reset behavior, or retry contract found |
| Fresh TTL / maximum stale | Not assigned; cache policy cannot make an unsupported source integration safe |

## Decision

Task 31 is complete with a **NO-GO** decision. AISideQuest must not register an Algora adapter or call/scrape Algora in production under the current evidence. A curated website page is not a supported public API, and inventing an organization list would create an unowned, incomplete discovery scope.

The decision may be reopened only when at least one of the following is obtained:

- an official, documented public global-discovery API with reuse/attribution and rate-limit terms; or
- written Algora approval plus a product-owner-approved organization allowlist with an authoritative source, owner, review cadence, removal procedure, request cap, cache TTL, maximum stale age, and incident behavior.

Until then, `ALGORA` remains a disabled source catalog entry and no Algora data is fetched or stored.
