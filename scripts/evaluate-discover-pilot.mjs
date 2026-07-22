import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { validateDiscoverPilotWindow } from './collect-discover-pilot.mjs'

const PREFLIGHT_GATES = [
  'dashboardProvisioned',
  'alertDeliveryVerified',
  'alertAckVerified',
  'aggregationFixturePassed',
  'analyticsRetentionVerified',
  'exportDeleteVerified',
  'forbiddenFieldsVerified',
]
const DISCOVER_SOURCES = new Set([
  'HACKER_NEWS', 'REMOTIVE', 'DEV', 'STACK_EXCHANGE', 'GITHUB', 'ALGORA',
])

const nonNegativeInteger = (value) => Number.isInteger(value) && value >= 0
const rate = (numerator, denominator) => denominator === 0 ? null : numerator / denominator
const rounded = (value) => value === null ? null : Number(value.toFixed(4))

export function evaluateDiscoverPilot(input) {
  const errors = []
  try {
    validateDiscoverPilotWindow(
      input.observationStartedAt,
      input.observationEndedAt,
      input.reportTimeZone,
    )
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  const metrics = input.metrics ?? {}
  const countFields = [
    'aiSessionUsers', 'discoverUsers', 'outboundUsers', 'saveUsers', 'repeatUsers',
    'eventCount', 'discoverViewEvents', 'tabViewEvents', 'outboundEvents', 'saveEvents',
    'cashBountyItemsObserved',
  ]
  for (const field of countFields) {
    if (!nonNegativeInteger(metrics[field])) errors.push(`${field} must be a non-negative integer`)
  }
  if (nonNegativeInteger(metrics.discoverUsers)) {
    for (const field of ['outboundUsers', 'saveUsers', 'repeatUsers']) {
      if (nonNegativeInteger(metrics[field]) && metrics[field] > metrics.discoverUsers) {
        errors.push(`${field} cannot exceed discoverUsers`)
      }
    }
  }
  if (nonNegativeInteger(metrics.eventCount)) {
    const eventTotal = ['discoverViewEvents', 'tabViewEvents', 'outboundEvents', 'saveEvents']
      .reduce((sum, field) => sum + (nonNegativeInteger(metrics[field]) ? metrics[field] : 0), 0)
    if (eventTotal !== metrics.eventCount) errors.push('eventCount must equal the four fixed event totals')
  }

  const sourceMetrics = Array.isArray(input.sourceMetrics) ? input.sourceMetrics : []
  const seenSources = new Set()
  for (const [index, source] of sourceMetrics.entries()) {
    if (!DISCOVER_SOURCES.has(source?.source)) errors.push(`sourceMetrics[${index}].source must use the fixed source allowlist`)
    if (seenSources.has(source?.source)) errors.push(`sourceMetrics contains duplicate source ${source?.source}`)
    seenSources.add(source?.source)
    for (const field of ['refreshAttempts', 'successfulRefreshes', 'failedRefreshes', 'zeroItemRefreshes']) {
      if (!nonNegativeInteger(source?.[field])) errors.push(`sourceMetrics[${index}].${field} must be a non-negative integer`)
    }
    if (nonNegativeInteger(source?.zeroItemRefreshes) && nonNegativeInteger(source?.successfulRefreshes)
      && source.zeroItemRefreshes > source.successfulRefreshes) {
      errors.push(`sourceMetrics[${index}].zeroItemRefreshes cannot exceed successfulRefreshes`)
    }
    if (nonNegativeInteger(source?.failedRefreshes) && nonNegativeInteger(source?.refreshAttempts)
      && source.failedRefreshes > source.refreshAttempts) {
      errors.push(`sourceMetrics[${index}].failedRefreshes cannot exceed refreshAttempts`)
    }
  }

  const missingPreflight = PREFLIGHT_GATES.filter((gate) => input.preflight?.[gate] !== true)
  const samplePlan = input.samplePlan ?? {}
  const decisionPlan = input.decisionPlan ?? {}
  if (samplePlan.approvedBeforeStart !== true) errors.push('sample plan must be approved before the pilot starts')
  if (decisionPlan.approvedBeforeStart !== true) errors.push('decision plan must be approved before the pilot starts')

  for (const field of ['minimumAiSessionUsers', 'minimumDiscoverUsers', 'minimumDiscoverViewEvents']) {
    if (!Number.isInteger(samplePlan[field]) || samplePlan[field] <= 0) errors.push(`${field} must be a positive integer`)
  }
  for (const field of ['minimumDiscoverEntryRate', 'minimumSaveRate', 'minimumRepeatVisitRate']) {
    if (typeof decisionPlan[field] !== 'number' || decisionPlan[field] < 0 || decisionPlan[field] > 1) {
      errors.push(`${field} must be between 0 and 1`)
    }
  }
  if (!nonNegativeInteger(decisionPlan.minimumCashBountyItems)) {
    errors.push('minimumCashBountyItems must be a non-negative integer')
  }

  const calculatedMetrics = {
    ...metrics,
    discoverEntryRate: rounded(rate(metrics.discoverUsers, metrics.aiSessionUsers)),
    outboundRate: rounded(rate(metrics.outboundUsers, metrics.discoverUsers)),
    saveRate: rounded(rate(metrics.saveUsers, metrics.discoverUsers)),
    repeatVisitRate: rounded(rate(metrics.repeatUsers, metrics.discoverUsers)),
    sourceRefreshAttempts: sourceMetrics.reduce((sum, value) => sum + (value.refreshAttempts ?? 0), 0),
    sourceRefreshFailures: sourceMetrics.reduce((sum, value) => sum + (value.failedRefreshes ?? 0), 0),
    sourceZeroItemRefreshes: sourceMetrics.reduce((sum, value) => sum + (value.zeroItemRefreshes ?? 0), 0),
  }
  calculatedMetrics.sourceFailureRate = rounded(rate(
    calculatedMetrics.sourceRefreshFailures,
    calculatedMetrics.sourceRefreshAttempts,
  ))
  const successfulRefreshes = sourceMetrics.reduce((sum, value) => sum + (value.successfulRefreshes ?? 0), 0)
  calculatedMetrics.sourceEmptyResultRate = rounded(rate(
    calculatedMetrics.sourceZeroItemRefreshes,
    successfulRefreshes,
  ))

  let status = 'READY_FOR_PRODUCT_DECISION'
  let reasons = []
  if (missingPreflight.length > 0) {
    status = 'NOT_READY'
    reasons = missingPreflight.map((gate) => `preflight gate not verified: ${gate}`)
  } else if (errors.length > 0) {
    status = 'INVALID_OBSERVATION'
    reasons = errors
  } else {
    const sampleGaps = []
    if (metrics.aiSessionUsers < samplePlan.minimumAiSessionUsers) sampleGaps.push('AI session user sample is below the pre-approved target')
    if (metrics.discoverUsers < samplePlan.minimumDiscoverUsers) sampleGaps.push('Discover user sample is below the pre-approved target')
    if (metrics.discoverViewEvents < samplePlan.minimumDiscoverViewEvents) sampleGaps.push('Discover view event sample is below the pre-approved target')
    if (sampleGaps.length > 0) {
      status = 'EXTEND_PILOT'
      reasons = sampleGaps
    }
  }

  const recommendations = status === 'READY_FOR_PRODUCT_DECISION' ? {
    sourceExpansion: calculatedMetrics.discoverEntryRate >= decisionPlan.minimumDiscoverEntryRate
      ? 'ELIGIBLE_FOR_REVIEW' : 'STOP_EXPANSION',
    personalization: calculatedMetrics.saveRate >= decisionPlan.minimumSaveRate
      ? 'ELIGIBLE_FOR_REVIEW' : 'DO_NOT_ADD_COMPLEX_PERSONALIZATION',
    earningCategory: metrics.cashBountyItemsObserved >= decisionPlan.minimumCashBountyItems
      ? 'BOUNTY_SCOPE_ELIGIBLE_FOR_REVIEW' : 'KEEP_JOBS_AND_CONTRACTS_FOCUS',
    firstPartyCommunity: calculatedMetrics.repeatVisitRate >= decisionPlan.minimumRepeatVisitRate
      ? 'ELIGIBLE_FOR_REVIEW' : 'DEFER',
  } : null

  return {
    status,
    reasons,
    metrics: calculatedMetrics,
    sourceMetrics,
    recommendations,
  }
}

async function main() {
  const [filePath] = process.argv.slice(2)
  if (!filePath) throw new Error('usage: npm run discover:pilot:evaluate -- <observation.json>')
  const result = evaluateDiscoverPilot(JSON.parse(await readFile(filePath, 'utf8')))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status !== 'READY_FOR_PRODUCT_DECISION') process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
