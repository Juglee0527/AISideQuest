import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const queueWorker = fileURLToPath(new URL('./queue-worker.mjs', import.meta.url))
const heartbeatWorker = fileURLToPath(new URL('./heartbeat-worker.mjs', import.meta.url))

function launch(script, environment) {
  const child = spawn(process.execPath, [script], {
    detached: true,
    env: { ...process.env, ...environment },
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

export function launchQueueWorker(environment = process.env) {
  launch(queueWorker, environment)
}

export function launchHeartbeatWorker(environment = process.env) {
  launch(heartbeatWorker, environment)
}
