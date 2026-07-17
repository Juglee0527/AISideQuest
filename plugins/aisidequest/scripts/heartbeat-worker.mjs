import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { enqueueEvent } from './delivery-queue.mjs'
import { resolveDataDirectory } from './event-recorder.mjs'
import { acquireProcessLock } from './process-lock.mjs'
import { readActiveTurn, markHeartbeat } from './turn-state.mjs'
import { launchQueueWorker } from './worker-launcher.mjs'

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const HEARTBEAT_INTERVAL_MS = positiveNumber(
  process.env.AISIDEQUEST_HEARTBEAT_INTERVAL_MS,
  30_000,
)
const POLL_INTERVAL_MS = Math.min(1_000, Math.max(25, HEARTBEAT_INTERVAL_MS / 4))

async function main() {
  const directory = resolveDataDirectory()
  const release = await acquireProcessLock(join(directory, 'heartbeat-worker.lock'))
  if (release === null) return

  try {
    while (true) {
      const turn = await readActiveTurn()
      if (turn === null) return
      const now = new Date()
      const lastHeartbeatAt = Date.parse(turn.lastHeartbeatAt ?? turn.activatedAt)

      if (!Number.isFinite(lastHeartbeatAt) || now.getTime() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        await enqueueEvent({
          schemaVersion: 1,
          eventId: randomUUID(),
          provider: 'CODEX',
          event: 'Heartbeat',
          sessionKey: turn.sessionKey,
          turnKey: turn.turnKey,
          observedAt: now.toISOString(),
        }, { now })
        await markHeartbeat(turn, process.env, now)
        launchQueueWorker()
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  } finally {
    await release()
  }
}

await main().catch(() => undefined)
