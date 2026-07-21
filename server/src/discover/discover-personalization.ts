import {
  type DiscoverCursor,
  type DiscoverInterestTag,
  type DiscoverItem,
  type DiscoverRecommendationReason,
  type DiscoverSource,
} from './discover.types'

const DAY_MS = 24 * 60 * 60_000

export interface RankedDiscoverItem {
  item: DiscoverItem
  interestMatches: number
  matchedInterests: DiscoverInterestTag[]
  recencyBand: number
  engagementValue: number
  clearValue: boolean
  sortAt: string
  reasons: DiscoverRecommendationReason[]
}

export function rankDiscoverItems(
  items: readonly DiscoverItem[],
  interests: readonly DiscoverInterestTag[],
) {
  const personalized = interests.length > 0
  const latestTimestamp = items.reduce(
    (latest, item) => Math.max(latest, Date.parse(itemSortAt(item))),
    0,
  )
  return items
    .map((item) => createRankedItem(item, interests, latestTimestamp))
    .sort((left, right) => compareRankedItems(left, right, personalized))
}

export function compareRankedItems(
  left: RankedDiscoverItem,
  right: RankedDiscoverItem | DiscoverCursor,
  personalized: boolean,
) {
  if (personalized) {
    const byMatches = right.interestMatches - left.interestMatches
    if (byMatches !== 0) return byMatches
    const byRecencyBand = left.recencyBand - right.recencyBand
    if (byRecencyBand !== 0) return byRecencyBand
    const byEngagement = right.engagementValue - left.engagementValue
    if (byEngagement !== 0) return byEngagement
    const byClearValue = Number(right.clearValue) - Number(left.clearValue)
    if (byClearValue !== 0) return byClearValue
  }
  return compareChronologicalKeys(left, right)
}

function createRankedItem(
  item: DiscoverItem,
  interests: readonly DiscoverInterestTag[],
  latestTimestamp: number,
): RankedDiscoverItem {
  const itemTags = new Set(item.tags)
  const matchedInterests = interests.filter((tag) => itemTags.has(tag))
  const sortAt = itemSortAt(item)
  const ageFromNewest = Math.max(0, latestTimestamp - Date.parse(sortAt))
  const recencyBand = ageFromNewest <= DAY_MS
    ? 0
    : ageFromNewest <= 7 * DAY_MS
      ? 1
      : ageFromNewest <= 30 * DAY_MS
        ? 2
        : 3
  const engagementValue = item.engagement?.value ?? 0
  const clearValue = item.reward !== null || item.compensation?.provided === true
  const reasons: DiscoverRecommendationReason[] = []
  if (matchedInterests.length > 0) reasons.push('INTEREST_MATCH')
  if (recencyBand === 0) reasons.push('RECENT')
  if (engagementValue > 0) reasons.push('EXTERNAL_ENGAGEMENT')
  if (clearValue) reasons.push('CLEAR_VALUE')
  return {
    item,
    interestMatches: matchedInterests.length,
    matchedInterests,
    recencyBand,
    engagementValue,
    clearValue,
    sortAt,
    reasons,
  }
}

function itemSortAt(item: DiscoverItem) {
  return item.publishedAt ?? item.fetchedAt
}

function compareChronologicalKeys(
  left: { sortAt: string; source?: DiscoverSource; item?: DiscoverItem; id?: string },
  right: { sortAt: string; source?: DiscoverSource; item?: DiscoverItem; id?: string },
) {
  const byDate = Date.parse(right.sortAt) - Date.parse(left.sortAt)
  if (byDate !== 0) return byDate
  const leftSource = left.source ?? left.item?.source ?? ''
  const leftId = left.id ?? left.item?.id ?? ''
  const rightSource = right.source ?? right.item?.source ?? ''
  const rightId = right.id ?? right.item?.id ?? ''
  const bySource = leftSource.localeCompare(rightSource)
  return bySource !== 0 ? bySource : leftId.localeCompare(rightId)
}
