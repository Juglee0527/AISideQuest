import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0

export function evaluatePilot(input) {
  const start = new Date(input.observationStartedAt)
  const end = new Date(input.observationEndedAt)
  const observationDays = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    ? Math.max(0, (end.getTime() - start.getTime()) / 86_400_000)
    : 0
  const eligible = number(input.eligibleAutomaticSessions)
  const detected = number(input.detectedAutomaticSessions)
  const requests = number(input.httpRequests)
  const detectionRate = eligible === 0 ? 0 : detected / eligible
  const http5xxRate = requests === 0 ? 0 : number(input.http5xxResponses) / requests
  const targetAutoSessions = Math.max(50, number(input.targetAutomaticSessions) || 100)

  const stopReasons = []
  if (number(input.unrecoverableSessionLosses) > 0) stopReasons.push('unrecoverable session loss occurred')
  if (number(input.duplicatePointAwards) > 0) stopReasons.push('duplicate point award occurred')
  if (number(input.criticalPrivacyIncidents) > 0) stopReasons.push('critical privacy incident occurred')
  if (number(input.criticalAuthIncidents) > 0) stopReasons.push('critical authentication incident occurred')
  if (number(input.forbiddenPayloadIncidents) > 0) stopReasons.push('forbidden prompt, response, code, or path data was transmitted')

  const sampleGaps = []
  if (observationDays < 7) sampleGaps.push(`observation period is ${observationDays.toFixed(1)} of 7 days`)
  if (number(input.invitedUsers) < 10) sampleGaps.push('fewer than 10 users were invited')
  if (number(input.completedFullFlowUsers) < 10) sampleGaps.push('fewer than 10 users completed the full flow')
  if (eligible < targetAutoSessions) sampleGaps.push(`${eligible} of ${targetAutoSessions} target automatic sessions were observed`)

  const qualityFailures = []
  if (detectionRate < 0.95) qualityFailures.push(`automatic detection rate is ${(detectionRate * 100).toFixed(2)}%, below 95%`)
  if (http5xxRate >= 0.01) qualityFailures.push(`5xx rate is ${(http5xxRate * 100).toFixed(2)}%, not below 1%`)
  if (number(input.queuePermanentFailures) > 0) qualityFailures.push('permanent plugin queue failures occurred')
  if (number(input.duplicateSessions) > 0) qualityFailures.push('duplicate sessions occurred')
  if (number(input.stateReflectionP95Ms) > 5_000) qualityFailures.push('state reflection p95 exceeded 5 seconds')

  let decision = 'CONTINUE_BETA'
  let reasons = []
  if (stopReasons.length > 0) {
    decision = 'STOP_PILOT'
    reasons = stopReasons
  } else if (sampleGaps.length > 0) {
    decision = 'EXTEND_PILOT'
    reasons = sampleGaps
  } else if (qualityFailures.length > 0) {
    decision = 'FIX_BEFORE_EXPANSION'
    reasons = qualityFailures
  }

  return {
    decision,
    reasons,
    metrics: {
      observationDays: Number(observationDays.toFixed(2)),
      invitedUsers: number(input.invitedUsers),
      completedFullFlowUsers: number(input.completedFullFlowUsers),
      eligibleAutomaticSessions: eligible,
      targetAutomaticSessions: targetAutoSessions,
      fiftySessionCheckpointReached: eligible >= 50,
      detectionRate: Number(detectionRate.toFixed(4)),
      http5xxRate: Number(http5xxRate.toFixed(4)),
      unrecoverableSessionLosses: number(input.unrecoverableSessionLosses),
      duplicatePointAwards: number(input.duplicatePointAwards),
      duplicateSessions: number(input.duplicateSessions),
      stateReflectionP95Ms: number(input.stateReflectionP95Ms),
    },
  }
}

async function main() {
  const [filePath] = process.argv.slice(2)
  if (!filePath) throw new Error('usage: node scripts/evaluate-pilot.mjs <pilot-observation.json>')
  const result = evaluatePilot(JSON.parse(await readFile(filePath, 'utf8')))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.decision === 'STOP_PILOT') process.exitCode = 2
  else if (result.decision !== 'CONTINUE_BETA') process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
