import {
  appendEvent,
  resolveDataDirectory,
  sanitizeHookPayload,
} from './event-recorder.mjs'
import { enqueueEvent } from './durable-event-queue.mjs'
import { updateHeartbeatState } from './heartbeat-state.mjs'
import { ensureDeliveryWorker } from './worker-launcher.mjs'

const MAX_INPUT_BYTES = 64 * 1024

async function readStandardInput() {
  const chunks = []
  let totalBytes = 0

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length

    if (totalBytes > MAX_INPUT_BYTES) {
      return null
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  try {
    const rawInput = await readStandardInput()

    if (rawInput === null) {
      return
    }

    const payload = JSON.parse(rawInput)
    const event = sanitizeHookPayload(payload)

    if (event === null) {
      return
    }

    const dataDirectory = resolveDataDirectory()

    if (event.event === 'Stop') {
      await enqueueEvent(event, dataDirectory)
      await updateHeartbeatState(event, dataDirectory)
    } else {
      await updateHeartbeatState(event, dataDirectory)
      await enqueueEvent(event, dataDirectory)
    }

    await appendEvent(event, dataDirectory)
    ensureDeliveryWorker()
  } catch {
    // Telemetry must never block or fail the Codex task.
  }
}

await main()
