import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { resolveDataDirectory } from './event-recorder.mjs'

const workerPath = fileURLToPath(
  new URL('./queue-worker.mjs', import.meta.url),
)

export function ensureDeliveryWorker(environment = process.env) {
  const dataDirectory = resolveDataDirectory(environment)
  const child = spawn(process.execPath, [workerPath], {
    detached: true,
    env: {
      ...environment,
      AISIDEQUEST_DATA_DIR: dataDirectory,
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return child.pid
}
