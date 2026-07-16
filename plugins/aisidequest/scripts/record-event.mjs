import {
  appendEvent,
  resolveDataDirectory,
  sanitizeHookPayload,
} from './event-recorder.mjs'

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

    await appendEvent(event, resolveDataDirectory())
  } catch {
    // Telemetry must never block or fail the Codex task.
  }
}

await main()
