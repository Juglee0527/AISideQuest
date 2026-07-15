import assert from 'node:assert/strict'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  hashIdentifier,
  sanitizeHookPayload,
} from '../scripts/event-recorder.mjs'

const scriptPath = fileURLToPath(new URL('../scripts/record-event.mjs', import.meta.url))

function runRecorder(payload, dataDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        AISIDEQUEST_POC_DATA_DIR: dataDirectory,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let standardError = ''

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      standardError += chunk
    })
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve()
        return
      }

      reject(new Error(`Recorder exited with ${exitCode}: ${standardError}`))
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

test('hashes identifiers deterministically without retaining the source value', () => {
  const firstHash = hashIdentifier('session-123')
  const secondHash = hashIdentifier('session-123')

  assert.equal(firstHash, secondHash)
  assert.equal(firstHash?.length, 64)
  assert.notEqual(firstHash, 'session-123')
})

test('keeps only the event, hashed identifiers, and receive time', () => {
  const event = sanitizeHookPayload(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-123',
      turn_id: 'turn-456',
      transcript_path: 'C:\\private\\transcript.jsonl',
      cwd: 'C:\\private\\source',
      model: 'private-model',
      prompt: 'private prompt',
      tool_input: { command: 'private command' },
    },
    new Date('2026-07-15T12:00:00.000Z'),
  )

  assert.deepEqual(Object.keys(event ?? {}).sort(), [
    'event',
    'receivedAt',
    'schemaVersion',
    'sessionHash',
    'turnHash',
  ])
  assert.equal(event?.event, 'UserPromptSubmit')
  assert.equal(event?.receivedAt, '2026-07-15T12:00:00.000Z')
  assert.doesNotMatch(JSON.stringify(event), /private|prompt|transcript|source|command/)
})

test('ignores unsupported events and malformed identifiers', () => {
  assert.equal(
    sanitizeHookPayload({ hook_event_name: 'Unknown', session_id: 'session-123' }),
    null,
  )
  assert.equal(
    sanitizeHookPayload({ hook_event_name: 'Stop', session_id: '' }),
    null,
  )
})

test('writes a privacy-filtered JSONL event through the command entrypoint', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aisidequest-hook-test-'))

  try {
    await runRecorder(
      {
        hook_event_name: 'Stop',
        session_id: 'session-123',
        turn_id: 'turn-456',
        prompt: 'must not be persisted',
        transcript_path: 'must not be persisted',
      },
      dataDirectory,
    )

    const log = await readFile(join(dataDirectory, 'events.jsonl'), 'utf8')
    const event = JSON.parse(log.trim())

    assert.equal(event.event, 'Stop')
    assert.equal(event.sessionHash, hashIdentifier('session-123'))
    assert.equal(event.turnHash, hashIdentifier('turn-456'))
    assert.doesNotMatch(log, /must not be persisted|prompt|transcript_path/)
  } finally {
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
