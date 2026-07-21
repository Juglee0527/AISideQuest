export type DiscoverFetchFailure =
  | 'INVALID_REQUEST'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'UPSTREAM'
  | 'INVALID_RESPONSE'

export class DiscoverFetchError extends Error {
  constructor(readonly reason: DiscoverFetchFailure) {
    super(`Discover source request failed: ${reason}`)
    this.name = 'DiscoverFetchError'
  }
}

export interface DiscoverJsonRequest {
  url: string
  allowedHosts: readonly string[]
  accept?: string
  timeoutMs?: number
  maxAttempts?: number
  maxResponseBytes?: number
}

interface DiscoverHttpClientDependencies {
  fetch?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000
const MAX_RETRY_DELAY_MS = 2_000

export class DiscoverHttpClient {
  private readonly fetchImplementation: typeof fetch
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(dependencies: DiscoverHttpClientDependencies = {}) {
    this.fetchImplementation = dependencies.fetch ?? fetch
    this.sleep = dependencies.sleep
      ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  async getJson(request: DiscoverJsonRequest): Promise<unknown> {
    const url = this.validateUrl(request.url, request.allowedHosts)
    const accept = this.validateHeaderValue(request.accept ?? 'application/json')
    const timeoutMs = this.validatePositiveInteger(request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const maxAttempts = this.validatePositiveInteger(request.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
    const maxResponseBytes = this.validatePositiveInteger(
      request.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    )

    if (maxAttempts > 3) {
      throw new DiscoverFetchError('INVALID_REQUEST')
    }

    let lastFailure: DiscoverFetchError | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.fetchOnce(url, accept, timeoutMs, maxResponseBytes)
      } catch (error) {
        const failure = this.toFetchError(error)
        lastFailure = failure
        if (attempt === maxAttempts || !this.isRetryable(failure.reason)) {
          throw failure
        }
        await this.sleep(Math.min(250 * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS))
      }
    }

    throw lastFailure ?? new DiscoverFetchError('NETWORK')
  }

  private async fetchOnce(
    url: URL,
    accept: string,
    timeoutMs: number,
    maxResponseBytes: number,
  ) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await this.fetchImplementation(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept,
          'user-agent': 'AISideQuest-Discover/1.0',
        },
      })

      if (response.status >= 300 && response.status < 400) {
        throw new DiscoverFetchError('INVALID_RESPONSE')
      }
      if (response.status === 429) {
        throw new DiscoverFetchError('RATE_LIMITED')
      }
      if (response.status === 408 || response.status === 425) {
        throw new DiscoverFetchError('UPSTREAM')
      }
      if (response.status < 200 || response.status >= 300) {
        throw new DiscoverFetchError(
          response.status >= 500 ? 'UPSTREAM' : 'INVALID_RESPONSE',
        )
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/.test(contentType)) {
        throw new DiscoverFetchError('INVALID_RESPONSE')
      }

      const declaredLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        throw new DiscoverFetchError('INVALID_RESPONSE')
      }

      const bytes = await this.readBoundedBody(response, maxResponseBytes)
      try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
      } catch {
        throw new DiscoverFetchError('INVALID_RESPONSE')
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DiscoverFetchError('TIMEOUT')
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  private async readBoundedBody(response: Response, maxResponseBytes: number) {
    if (!response.body) return new Uint8Array()

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > maxResponseBytes) {
          throw new DiscoverFetchError('INVALID_RESPONSE')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const body = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body
  }

  private validateUrl(value: string, allowedHosts: readonly string[]) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new DiscoverFetchError('INVALID_REQUEST')
    }

    const normalizedHosts = new Set(allowedHosts.map((host) => host.toLowerCase()))
    if (
      url.protocol !== 'https:'
      || url.username !== ''
      || url.password !== ''
      || (url.port !== '' && url.port !== '443')
      || !normalizedHosts.has(url.hostname.toLowerCase())
    ) {
      throw new DiscoverFetchError('INVALID_REQUEST')
    }
    return url
  }

  private validatePositiveInteger(value: number) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new DiscoverFetchError('INVALID_REQUEST')
    }
    return value
  }

  private validateHeaderValue(value: string) {
    if (
      typeof value !== 'string'
      || value.length === 0
      || value.length > 200
      || value.trim() !== value
      || !/^[\x20-\x7E]+$/.test(value)
    ) {
      throw new DiscoverFetchError('INVALID_REQUEST')
    }
    return value
  }

  private toFetchError(error: unknown) {
    return error instanceof DiscoverFetchError
      ? error
      : new DiscoverFetchError('NETWORK')
  }

  private isRetryable(reason: DiscoverFetchFailure) {
    return reason === 'TIMEOUT'
      || reason === 'NETWORK'
      || reason === 'RATE_LIMITED'
      || reason === 'UPSTREAM'
  }
}
