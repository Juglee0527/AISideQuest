import { Injectable } from '@nestjs/common'

import { validationError } from '../sessions/session-input'
import type { DiscoverListQueryDto } from './discover.dto'
import {
  DISCOVER_SOURCES,
  type DiscoverCategory,
  type DiscoverCursor,
  type DiscoverListResult,
  type DiscoverSource,
  type DiscoverSourceListResult,
  type DiscoverSourceSnapshot,
} from './discover.types'

const DISCOVER_ITEM_ID_PATTERN = /^(HACKER_NEWS|REMOTIVE|DEV|STACK_EXCHANGE|GITHUB|ALGORA):[A-Za-z0-9_-]{1,200}$/

const SOURCE_CATALOG: readonly DiscoverSourceSnapshot[] = [
  {
    source: 'HACKER_NEWS',
    displayName: 'Hacker News',
    categories: ['EARNING', 'NEWS', 'COMMUNITY'],
    enabled: false,
    status: 'UNAVAILABLE',
    fetchedAt: null,
  },
  {
    source: 'REMOTIVE',
    displayName: 'Remotive',
    categories: ['EARNING'],
    enabled: false,
    status: 'UNAVAILABLE',
    fetchedAt: null,
  },
  {
    source: 'DEV',
    displayName: 'DEV Community',
    categories: ['NEWS'],
    enabled: false,
    status: 'UNAVAILABLE',
    fetchedAt: null,
  },
  {
    source: 'STACK_EXCHANGE',
    displayName: 'Stack Overflow',
    categories: ['COMMUNITY'],
    enabled: false,
    status: 'UNAVAILABLE',
    fetchedAt: null,
  },
  {
    source: 'GITHUB',
    displayName: 'GitHub',
    categories: ['COMMUNITY'],
    enabled: false,
    status: 'UNAVAILABLE',
    fetchedAt: null,
  },
  {
    source: 'ALGORA',
    displayName: 'Algora',
    categories: ['EARNING'],
    enabled: false,
    status: 'UNAVAILABLE',
    fetchedAt: null,
  },
]

@Injectable()
export class DiscoverService {
  listDiscover(
    _userId: string,
    query: DiscoverListQueryDto,
  ): DiscoverListResult {
    if (query.cursor) {
      this.decodeCursor(query.cursor)
    }

    return {
      items: [],
      nextCursor: null,
      sources: this.filterSources(query.source, query.category),
    }
  }

  listSources(): DiscoverSourceListResult {
    return { sources: this.filterSources() }
  }

  private filterSources(
    source?: DiscoverSource,
    category?: DiscoverCategory,
  ) {
    return SOURCE_CATALOG
      .filter((entry) => source === undefined || entry.source === source)
      .filter((entry) => category === undefined || entry.categories.includes(category))
      .map((entry) => ({ ...entry, categories: [...entry.categories] }))
  }

  private decodeCursor(cursor: string): DiscoverCursor {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
      validationError('cursor is invalid')
    }

    let value: unknown
    try {
      value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    } catch {
      validationError('cursor is invalid')
    }

    if (
      typeof value !== 'object'
      || value === null
      || Array.isArray(value)
      || !('version' in value)
      || value.version !== 1
      || !('sortAt' in value)
      || typeof value.sortAt !== 'string'
      || !Number.isFinite(Date.parse(value.sortAt))
      || !('source' in value)
      || typeof value.source !== 'string'
      || !DISCOVER_SOURCES.includes(value.source as DiscoverSource)
      || !('id' in value)
      || typeof value.id !== 'string'
      || !DISCOVER_ITEM_ID_PATTERN.test(value.id)
      || !value.id.startsWith(`${value.source}:`)
    ) {
      validationError('cursor is invalid')
    }

    return {
      version: 1,
      sortAt: new Date(value.sortAt).toISOString(),
      source: value.source as DiscoverSource,
      id: value.id,
    }
  }
}
