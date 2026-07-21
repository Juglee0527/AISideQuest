import {
  DISCOVER_CATEGORIES,
  DISCOVER_KINDS,
  DISCOVER_SOURCES,
  type DiscoverItem,
  type DiscoverSource,
} from './discover.types'

const ITEM_ID_PATTERN = /^(HACKER_NEWS|REMOTIVE|DEV|STACK_EXCHANGE|GITHUB|ALGORA):[A-Za-z0-9_-]{1,200}$/
const TAGS = /<[^>]*>/g
const UNSAFE_BLOCKS = /<(script|style|template|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const ENTITY_PATTERN = /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi

const ENTITY_VALUES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function toDiscoverPlainText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value
    .replace(UNSAFE_BLOCKS, ' ')
    .replace(TAGS, ' ')
    .replace(ENTITY_PATTERN, (_match, entity: string) => decodeEntity(entity))
    .split('')
    .filter((character) => !isForbiddenControlCharacter(character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

export function normalizeDiscoverItem(
  value: DiscoverItem,
  expectedSource: DiscoverSource,
): DiscoverItem {
  if (
    value.source !== expectedSource
    || !DISCOVER_SOURCES.includes(value.source)
    || !ITEM_ID_PATTERN.test(value.id)
    || !value.id.startsWith(`${value.source}:`)
    || !DISCOVER_CATEGORIES.includes(value.category)
    || !DISCOVER_KINDS.includes(value.kind)
  ) {
    throw new Error('Invalid normalized Discover item identity')
  }

  const originalUrl = normalizeHttpsUrl(value.originalUrl)
  const fetchedAt = normalizeDate(value.fetchedAt, false)
  const publishedAt = normalizeDate(value.publishedAt, true)
  const title = toDiscoverPlainText(value.title, 300)
  const attribution = toDiscoverPlainText(value.attribution, 100)
  if (!title || !attribution) {
    throw new Error('Invalid normalized Discover item text')
  }
  validateClassification(value)

  return {
    ...value,
    title,
    summary: value.summary === null
      ? null
      : toDiscoverPlainText(value.summary, 1_000) || null,
    tags: [...new Set(value.tags
      .map((tag) => toDiscoverPlainText(tag, 50).toLowerCase())
      .filter(Boolean))].slice(0, 20),
    reward: normalizeReward(value.reward),
    compensation: normalizeCompensation(value.compensation),
    originalUrl,
    attribution,
    publishedAt,
    fetchedAt,
  }
}

function normalizeHttpsUrl(value: string) {
  if ([...value].some((character) => isForbiddenControlCharacter(character) || character === '\r' || character === '\n')) {
    throw new Error('Invalid Discover display URL')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid Discover display URL')
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.href.length > 2_000
  ) {
    throw new Error('Invalid Discover display URL')
  }
  return url.href
}

function normalizeDate(value: string, nullable: false): string
function normalizeDate(value: string | null, nullable: true): string | null
function normalizeDate(value: string | null, nullable: boolean) {
  if (value === null && nullable) return null
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Invalid Discover date')
  }
  return new Date(value).toISOString()
}

function normalizeReward(reward: DiscoverItem['reward']) {
  if (reward === null) return null
  if (reward.type === 'CASH_BOUNTY') {
    const currency = reward.currency.trim().toUpperCase()
    if (!Number.isSafeInteger(reward.amountMinor) || reward.amountMinor <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Invalid Discover cash reward')
    }
    return { ...reward, currency }
  }
  if (reward.type !== 'REPUTATION_BOUNTY') {
    throw new Error('Invalid Discover reward type')
  }
  if (!Number.isSafeInteger(reward.amount) || reward.amount <= 0) {
    throw new Error('Invalid Discover reputation reward')
  }
  return reward
}

function validateClassification(value: DiscoverItem) {
  const categoryKinds = {
    EARNING: new Set(['PAID_JOB', 'CASH_BOUNTY']),
    NEWS: new Set(['ARTICLE']),
    COMMUNITY: new Set(['DISCUSSION', 'REPUTATION_BOUNTY', 'OSS_TASK']),
  } as const
  if (!categoryKinds[value.category].has(value.kind as never)) {
    throw new Error('Invalid Discover category and kind')
  }

  if (value.kind === 'CASH_BOUNTY' && value.reward?.type !== 'CASH_BOUNTY') {
    throw new Error('Missing Discover cash reward')
  }
  if (value.kind === 'REPUTATION_BOUNTY' && value.reward?.type !== 'REPUTATION_BOUNTY') {
    throw new Error('Missing Discover reputation reward')
  }
  if (
    value.kind !== 'CASH_BOUNTY'
    && value.kind !== 'REPUTATION_BOUNTY'
    && value.reward !== null
  ) {
    throw new Error('Unexpected Discover reward')
  }
  if ((value.kind === 'PAID_JOB') !== (value.compensation !== null)) {
    throw new Error('Invalid Discover compensation classification')
  }
}

function normalizeCompensation(compensation: DiscoverItem['compensation']) {
  if (compensation === null) return null
  if (compensation.provided === false) {
    if (compensation.text !== null) {
      throw new Error('Invalid missing Discover compensation')
    }
    return { provided: false as const, text: null }
  }
  if (compensation.provided !== true) {
    throw new Error('Invalid Discover compensation type')
  }
  const text = toDiscoverPlainText(compensation.text, 300)
  if (!text) throw new Error('Invalid Discover compensation')
  return { provided: true as const, text }
}

function decodeEntity(entity: string) {
  const normalized = entity.toLowerCase()
  if (normalized.startsWith('#x')) {
    return safeCodePoint(Number.parseInt(normalized.slice(2), 16))
  }
  if (normalized.startsWith('#')) {
    return safeCodePoint(Number.parseInt(normalized.slice(1), 10))
  }
  return ENTITY_VALUES[normalized] ?? ' '
}

function safeCodePoint(value: number) {
  if (!Number.isInteger(value) || value <= 0 || value > 0x10FFFF) return ' '
  const character = String.fromCodePoint(value)
  return isForbiddenControlCharacter(character) ? '' : character
}

function isForbiddenControlCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0
  return (codePoint >= 0 && codePoint <= 8)
    || codePoint === 11
    || codePoint === 12
    || (codePoint >= 14 && codePoint <= 31)
    || codePoint === 127
}
