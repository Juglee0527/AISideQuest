import { Injectable } from '@nestjs/common'

import { DiscoverFetchError } from './discover-http-client'

const MINIMUM_REQUEST_INTERVAL_MS = 60_000
const MAXIMUM_BACKOFF_SECONDS = 86_400

interface StackExchangeRequestGateDependencies {
  now?: () => number
}

@Injectable()
export class StackExchangeRequestGate {
  private readonly now: () => number
  private readonly nextRequestAt = new Map<string, number>()
  private quotaAvailableAt = 0

  constructor(dependencies: StackExchangeRequestGateDependencies = {}) {
    this.now = dependencies.now ?? Date.now
  }

  reserve(requestKeys: readonly string[]) {
    const now = this.now()
    if (now < this.quotaAvailableAt) {
      throw new DiscoverFetchError('RATE_LIMITED')
    }

    const uniqueKeys = [...new Set(requestKeys)]
    if (uniqueKeys.some((key) => now < (this.nextRequestAt.get(key) ?? 0))) {
      throw new DiscoverFetchError('RATE_LIMITED')
    }

    for (const key of uniqueKeys) {
      this.nextRequestAt.set(key, now + MINIMUM_REQUEST_INTERVAL_MS)
    }
  }

  recordResponse(requestKey: string, backoffSeconds: number | null, quotaRemaining: number) {
    const now = this.now()
    if (backoffSeconds !== null) {
      if (
        !Number.isSafeInteger(backoffSeconds)
        || backoffSeconds <= 0
        || backoffSeconds > MAXIMUM_BACKOFF_SECONDS
      ) {
        throw new DiscoverFetchError('INVALID_RESPONSE')
      }
      this.nextRequestAt.set(
        requestKey,
        Math.max(this.nextRequestAt.get(requestKey) ?? 0, now + backoffSeconds * 1_000),
      )
    }

    if (!Number.isSafeInteger(quotaRemaining) || quotaRemaining < 0) {
      throw new DiscoverFetchError('INVALID_RESPONSE')
    }
    if (quotaRemaining === 0) {
      this.quotaAvailableAt = nextUtcDay(now)
    }
  }

  isQuotaExhausted() {
    return this.now() < this.quotaAvailableAt
  }
}

function nextUtcDay(now: number) {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
}
