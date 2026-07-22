import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  normalizeDiscoverPilotRow,
  validateDiscoverPilotWindow,
} from './collect-discover-pilot.mjs'
import { evaluateDiscoverPilot } from './evaluate-discover-pilot.mjs'

const healthy = {
  schemaVersion: 1,
  observationStartedAt: '2026-08-01T00:00:00.000Z',
  observationEndedAt: '2026-08-08T00:00:00.000Z',
  reportTimeZone: 'Asia/Seoul',
  preflight: {
    dashboardProvisioned: true,
    alertDeliveryVerified: true,
    alertAckVerified: true,
    aggregationFixturePassed: true,
    analyticsRetentionVerified: true,
    exportDeleteVerified: true,
    forbiddenFieldsVerified: true,
  },
  samplePlan: {
    approvedBeforeStart: true,
    minimumAiSessionUsers: 10,
    minimumDiscoverUsers: 10,
    minimumDiscoverViewEvents: 30,
  },
  decisionPlan: {
    approvedBeforeStart: true,
    minimumDiscoverEntryRate: 0.2,
    minimumSaveRate: 0.1,
    minimumRepeatVisitRate: 0.2,
    minimumCashBountyItems: 1,
  },
  metrics: {
    aiSessionUsers: 20,
    discoverUsers: 12,
    outboundUsers: 7,
    saveUsers: 3,
    repeatUsers: 4,
    eventCount: 67,
    discoverViewEvents: 36,
    tabViewEvents: 15,
    outboundEvents: 10,
    saveEvents: 6,
    cashBountyItemsObserved: 0,
  },
  sourceMetrics: [
    { source: 'HACKER_NEWS', refreshAttempts: 20, successfulRefreshes: 19, failedRefreshes: 1, zeroItemRefreshes: 0 },
    { source: 'REMOTIVE', refreshAttempts: 5, successfulRefreshes: 5, failedRefreshes: 0, zeroItemRefreshes: 1 },
  ],
}

test('validates exact seven-day UTC boundaries and normalizes aggregate rows', () => {
  assert.deepEqual(
    validateDiscoverPilotWindow(
      '2026-08-01T00:00:00.000Z',
      '2026-08-08T00:00:00.000Z',
      'Asia/Seoul',
    ),
    {
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-08T00:00:00.000Z',
      reportTimeZone: 'Asia/Seoul',
    },
  )
  assert.throws(
    () => validateDiscoverPilotWindow(
      '2026-08-01T01:00:00.000Z',
      '2026-08-08T01:00:00.000Z',
      'Asia/Seoul',
    ),
    /UTC midnight/,
  )
  assert.equal(normalizeDiscoverPilotRow({ ai_session_users: '3' }).aiSessionUsers, 3)
})

test('returns calculated rates and next-scope recommendations without a success label', () => {
  const result = evaluateDiscoverPilot(healthy)
  assert.equal(result.status, 'READY_FOR_PRODUCT_DECISION')
  assert.equal(result.metrics.discoverEntryRate, 0.6)
  assert.equal(result.metrics.sourceFailureRate, 0.04)
  assert.equal(result.metrics.sourceEmptyResultRate, 0.0417)
  assert.equal(result.recommendations.earningCategory, 'KEEP_JOBS_AND_CONTRACTS_FOCUS')
})

test('extends a complete seven-day observation when its pre-approved sample is insufficient', () => {
  const result = evaluateDiscoverPilot({
    ...healthy,
    metrics: { ...healthy.metrics, discoverUsers: 8, outboundUsers: 4, saveUsers: 2, repeatUsers: 2 },
  })
  assert.equal(result.status, 'EXTEND_PILOT')
  assert.match(result.reasons.join(' '), /Discover user sample/)
})

test('does not start before dashboard alert and privacy preflight evidence exists', () => {
  const result = evaluateDiscoverPilot({
    ...healthy,
    preflight: { ...healthy.preflight, alertAckVerified: false },
  })
  assert.equal(result.status, 'NOT_READY')
  assert.match(result.reasons[0], /alertAckVerified/)
})

test('rejects inconsistent fixed-event aggregates', () => {
  const result = evaluateDiscoverPilot({
    ...healthy,
    metrics: { ...healthy.metrics, eventCount: 999 },
  })
  assert.equal(result.status, 'INVALID_OBSERVATION')
  assert.match(result.reasons.join(' '), /four fixed event totals/)
})

test('example observation is fail-closed and contains aggregate fields only', async () => {
  const text = await readFile(new URL('../deploy/discover-pilot-observation.example.json', import.meta.url), 'utf8')
  assert.doesNotMatch(text, /userId|user_id|itemId|item_id|originalUrl|title|query|interest/i)
  assert.equal(evaluateDiscoverPilot(JSON.parse(text)).status, 'NOT_READY')
})
