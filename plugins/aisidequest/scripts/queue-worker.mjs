import { join } from 'node:path'

import { processNextEvent } from './delivery-queue.mjs'
import { resolveDataDirectory } from './event-recorder.mjs'
import { acquireProcessLock } from './process-lock.mjs'

const MAX_INLINE_WAIT_MS = 5 * 60 * 1_000

async function main() {
  const directory = resolveDataDirectory()
  const release = await acquireProcessLock(join(directory, 'delivery-worker.lock'))
  if (release === null) return

  try {
    while (true) {
      const result = await processNextEvent()
      if (result.status === 'EMPTY' || result.status === 'AUTH_BLOCKED') return
      if (result.waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(MAX_INLINE_WAIT_MS, result.waitMs)))
      }
    }
  } finally {
    await release()
  }
}

await main().catch(() => undefined)
