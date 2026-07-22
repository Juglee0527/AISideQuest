import { Injectable } from '@nestjs/common'

import { DiscoverFetchError } from './discover-http-client'

interface GithubSearchRequestGateDependencies {
  now?: () => number
}

@Injectable()
export class GithubSearchRequestGate {
  private readonly now: () => number
  private blockedUntil = 0

  constructor(dependencies: GithubSearchRequestGateDependencies = {}) {
    this.now = dependencies.now ?? Date.now
  }

  reserve() {
    if (this.now() < this.blockedUntil) {
      throw new DiscoverFetchError('RATE_LIMITED', this.blockedUntil)
    }
  }

  recordResponse(headers: Headers) {
    const resource = headers.get('x-ratelimit-resource')
    if (resource !== null && resource.toLowerCase() !== 'search') {
      throw new DiscoverFetchError('INVALID_RESPONSE')
    }

    const remainingValue = headers.get('x-ratelimit-remaining')
    if (remainingValue === null) return
    const remaining = Number(remainingValue)
    if (!Number.isSafeInteger(remaining) || remaining < 0) {
      throw new DiscoverFetchError('INVALID_RESPONSE')
    }
    if (remaining > 0) return

    const resetSeconds = Number(headers.get('x-ratelimit-reset'))
    if (!Number.isSafeInteger(resetSeconds) || resetSeconds <= 0) {
      throw new DiscoverFetchError('INVALID_RESPONSE')
    }
    this.blockedUntil = Math.max(this.blockedUntil, resetSeconds * 1_000)
  }

  recordFailure(error: unknown) {
    if (
      error instanceof DiscoverFetchError
      && error.reason === 'RATE_LIMITED'
      && error.retryAt !== null
    ) {
      this.blockedUntil = Math.max(this.blockedUntil, error.retryAt)
    }
  }
}
