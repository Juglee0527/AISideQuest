import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluatePilot } from './evaluate-pilot.mjs'

const healthy = {
  observationStartedAt: '2026-07-01T00:00:00Z', observationEndedAt: '2026-07-09T00:00:00Z',
  invitedUsers: 12, completedFullFlowUsers: 10,
  eligibleAutomaticSessions: 100, detectedAutomaticSessions: 97,
  targetAutomaticSessions: 100, httpRequests: 20_000, http5xxResponses: 10,
  unrecoverableSessionLosses: 0, duplicatePointAwards: 0, queuePermanentFailures: 0,
  criticalPrivacyIncidents: 0, criticalAuthIncidents: 0,
  forbiddenPayloadIncidents: 0, duplicateSessions: 0, stateReflectionP95Ms: 4_000,
}

test('continues beta only after sample and quality gates pass', () => {
  const result = evaluatePilot(healthy)
  assert.equal(result.decision, 'CONTINUE_BETA')
  assert.equal(result.metrics.fiftySessionCheckpointReached, true)
  assert.equal(result.metrics.detectionRate, 0.97)
})

test('extends a healthy but undersized pilot', () => {
  const result = evaluatePilot({ ...healthy, observationEndedAt: '2026-07-03T00:00:00Z', completedFullFlowUsers: 8, eligibleAutomaticSessions: 50 })
  assert.equal(result.decision, 'EXTEND_PILOT')
  assert.ok(result.reasons.length >= 2)
})

test('stops immediately for loss, duplicate awards, privacy, or auth incidents', () => {
  const result = evaluatePilot({ ...healthy, duplicatePointAwards: 1, criticalPrivacyIncidents: 1 })
  assert.equal(result.decision, 'STOP_PILOT')
  assert.equal(result.reasons.length, 2)
})

test('requires fixes when a complete sample misses quality targets', () => {
  const result = evaluatePilot({ ...healthy, detectedAutomaticSessions: 94, http5xxResponses: 200 })
  assert.equal(result.decision, 'FIX_BEFORE_EXPANSION')
})
