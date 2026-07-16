import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { connectDevice } from '../scripts/connect-device.mjs'
import {
  resolveConfigPath,
  writeDeviceConfig,
} from '../scripts/device-config.mjs'
import {
  enqueueEvent,
  readDeadLetterSnapshot,
  readQueueSnapshot,
  resolveQueueFilePath,
} from '../scripts/durable-event-queue.mjs'
import { deliverNextQueuedEvent } from '../scripts/delivery-worker.mjs'
import {
  hashIdentifier,
  sanitizeHookPayload,
} from '../scripts/event-recorder.mjs'
import {
  enqueueDueHeartbeat,
  updateHeartbeatState,
} from '../scripts/heartbeat-state.mjs'
import { sendTestEvent } from '../scripts/send-test-event.mjs'

const LINK_CODE = '123e4567-e89b-42d3-a456-426614174000'
const recorderScriptPath = fileURLToPath(
  new URL('../scripts/record-event.mjs', import.meta.url),
)

async function startApiServer(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  if (typeof address !== 'object' || address === null) {
    throw new Error('Failed to start test API server')
  }

  return {
    apiUrl: `http://127.0.0.1:${address.port}/api/v1`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

async function readRequest(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function runRecorder(payload, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [recorderScriptPath], {
      env: { ...process.env, ...environment },
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

async function waitFor(assertion, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      return assertion()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  return assertion()
}

function createEvent(event, index, observedAt = new Date()) {
  return {
    schemaVersion: 1,
    eventId: randomUUID(),
    provider: 'CODEX',
    event,
    sessionKey: hashIdentifier(`session-${index}`),
    ...(event === 'SessionStart'
      ? {}
      : { turnKey: hashIdentifier(`turn-${index}`) }),
    observedAt: observedAt.toISOString(),
  }
}

test('keeps only the server event contract and hashed identifiers', () => {
  const event = sanitizeHookPayload(
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'session-123',
      turn_id: 'turn-456',
      transcript_path: 'C:\\private\\transcript.jsonl',
      cwd: 'C:\\private\\source',
      prompt: 'private prompt',
      tool_input: { command: 'private command' },
    },
    new Date('2026-07-16T01:00:00.000Z'),
    '123e4567-e89b-42d3-a456-426614174001',
  )

  assert.deepEqual(Object.keys(event ?? {}).sort(), [
    'event',
    'eventId',
    'observedAt',
    'provider',
    'schemaVersion',
    'sessionKey',
    'turnKey',
  ])
  assert.equal(event?.sessionKey, hashIdentifier('session-123'))
  assert.equal(event?.turnKey, hashIdentifier('turn-456'))
  assert.doesNotMatch(JSON.stringify(event), /private|prompt|transcript|source|command/)
})

test('connects with a generated token and stores only device credentials locally', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aisidequest-plugin-'))
  const environment = { AISIDEQUEST_DATA_DIR: dataDirectory }
  let receivedRequest
  const api = await startApiServer(async (request, response) => {
    receivedRequest = {
      url: request.url,
      headers: request.headers,
      body: await readRequest(request),
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      data: {
        device: {
          id: '123e4567-e89b-42d3-a456-426614174002',
          name: 'Test device',
        },
      },
      meta: { serverTime: new Date().toISOString() },
    }))
  })

  try {
    await connectDevice({
      code: LINK_CODE,
      apiUrl: api.apiUrl,
      deviceName: 'Test device',
      environment,
    })

    assert.equal(receivedRequest.url, '/api/v1/device-links/redeem')
    assert.equal(receivedRequest.body.code, LINK_CODE)
    assert.match(receivedRequest.body.deviceToken, /^[A-Za-z0-9_-]{43}$/)
    assert.match(receivedRequest.headers['idempotency-key'], /^[0-9a-f-]{36}$/)

    const configText = await readFile(resolveConfigPath(environment), 'utf8')
    const config = JSON.parse(configText)

    assert.equal(config.deviceToken, receivedRequest.body.deviceToken)
    assert.equal(config.apiUrl, api.apiUrl)
    assert.doesNotMatch(configText, /github|oauth|access.?token/i)
  } finally {
    await api.close()
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

test('sends an explicit privacy-filtered test event with device authentication', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aisidequest-plugin-'))
  const environment = { AISIDEQUEST_DATA_DIR: dataDirectory }
  const requests = []
  const api = await startApiServer(async (request, response) => {
    const body = await readRequest(request)
    requests.push({ url: request.url, headers: request.headers, body })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      data: request.url?.endsWith('/device-links/redeem')
        ? {
            device: {
              id: '123e4567-e89b-42d3-a456-426614174003',
              name: 'Test device',
            },
          }
        : { eventId: body.eventId, result: 'APPLIED', session: null },
      meta: { serverTime: new Date().toISOString() },
    }))
  })

  try {
    await connectDevice({
      code: LINK_CODE,
      apiUrl: api.apiUrl,
      deviceName: 'Test device',
      environment,
    })
    const result = await sendTestEvent({ environment })
    const eventRequest = requests[1]

    assert.equal(result.result, 'APPLIED')
    assert.equal(eventRequest.url, '/api/v1/integration-events')
    assert.match(eventRequest.headers.authorization, /^Bearer [A-Za-z0-9_-]{43}$/)
    assert.equal(eventRequest.headers['idempotency-key'], eventRequest.body.eventId)
    assert.equal(eventRequest.body.event, 'SessionStart')
    assert.match(eventRequest.body.sessionKey, /^[0-9a-f]{64}$/)
    assert.doesNotMatch(JSON.stringify(eventRequest.body), /prompt|source|transcript|tool_input/)
  } finally {
    await api.close()
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

test('automatically sends every supported lifecycle event after local persistence', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aisidequest-plugin-'))
  const environment = { AISIDEQUEST_DATA_DIR: dataDirectory }
  const requests = []
  const api = await startApiServer(async (request, response) => {
    const body = await readRequest(request)
    requests.push({ url: request.url, headers: request.headers, body })
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      data: request.url?.endsWith('/device-links/redeem')
        ? {
            device: {
              id: '123e4567-e89b-42d3-a456-426614174004',
              name: 'Automatic detection device',
            },
          }
        : { eventId: body.eventId, result: 'APPLIED', session: null },
      meta: { serverTime: new Date().toISOString() },
    }))
  })
  const events = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PermissionRequest',
    'PostToolUse',
    'Stop',
  ]

  try {
    await connectDevice({
      code: LINK_CODE,
      apiUrl: api.apiUrl,
      deviceName: 'Automatic detection device',
      environment,
    })

    for (const event of events) {
      await runRecorder(
        {
          hook_event_name: event,
          session_id: 'session-automatic',
          ...(event === 'SessionStart' ? {} : { turn_id: 'turn-automatic' }),
          prompt: 'must not be sent',
          transcript_path: 'must not be sent',
          tool_input: { command: 'must not be sent' },
        },
        environment,
      )
    }

    await waitFor(() => assert.equal(requests.length, events.length + 1))

    const eventRequests = requests.slice(1)
    assert.deepEqual(
      eventRequests.map((request) => request.body.event),
      events,
    )

    for (const eventRequest of eventRequests) {
      assert.equal(
        eventRequest.headers['idempotency-key'],
        eventRequest.body.eventId,
      )
      assert.match(
        eventRequest.headers.authorization,
        /^Bearer [A-Za-z0-9_-]{43}$/,
      )
      assert.equal(
        eventRequest.body.sessionKey,
        hashIdentifier('session-automatic'),
      )
      assert.doesNotMatch(
        JSON.stringify(eventRequest.body),
        /prompt|transcript|tool_input|must not be sent/,
      )
    }

    const log = await readFile(join(dataDirectory, 'events.jsonl'), 'utf8')
    const localEvents = log.trim().split('\n').map((line) => JSON.parse(line))

    assert.deepEqual(
      localEvents.map((event) => event.eventId),
      eventRequests.map((request) => request.body.eventId),
    )
  } finally {
    await api.close()
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

test('durable queue preserves FIFO and acknowledges only accepted responses', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aisidequest-queue-'))
  const environment = { AISIDEQUEST_DATA_DIR: dataDirectory }
  const queuedAt = new Date('2026-07-16T00:00:00.000Z')
  const firstEvent = createEvent('UserPromptSubmit', 1, queuedAt)
  const secondEvent = createEvent('Stop', 1, queuedAt)
  let requestCount = 0
  const api = await startApiServer(async (request, response) => {
    const body = await readRequest(request)
    requestCount += 1

    if (requestCount === 1) {
      response.writeHead(503, {
        'Content-Type': 'application/json',
        'Retry-After': '2',
      })
      response.end(JSON.stringify({ error: { code: 'TEMPORARY_FAILURE' } }))
      return
    }

    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      data: { eventId: body.eventId, result: 'APPLIED', session: null },
    }))
  })

  try {
    await writeDeviceConfig({
      schemaVersion: 1,
      apiUrl: api.apiUrl,
      deviceToken: 'test-device-token',
      pluginVersion: 'test',
      device: { id: randomUUID(), name: 'Queue test' },
    }, environment)
    await enqueueEvent(firstEvent, dataDirectory, { now: queuedAt })
    await enqueueEvent(secondEvent, dataDirectory, { now: queuedAt })

    const firstAttempt = await deliverNextQueuedEvent(dataDirectory, {
      environment,
      now: new Date('2026-07-16T00:00:00.000Z'),
    })
    assert.equal(firstAttempt.status, 'RETRY_SCHEDULED')
    assert.equal(firstAttempt.waitMs, 2_000)

    const waitingQueue = await readQueueSnapshot(dataDirectory)
    assert.deepEqual(
      waitingQueue.map((item) => item.event.eventId),
      [firstEvent.eventId, secondEvent.eventId],
    )
    assert.equal(waitingQueue[0].attemptCount, 1)

    const deliveredFirst = await deliverNextQueuedEvent(dataDirectory, {
      environment,
      now: new Date('2026-07-16T00:00:02.000Z'),
    })
    assert.equal(deliveredFirst.status, 'DELIVERED')
    assert.equal(
      (await readQueueSnapshot(dataDirectory))[0].event.eventId,
      secondEvent.eventId,
    )

    const deliveredSecond = await deliverNextQueuedEvent(dataDirectory, {
      environment,
      now: new Date('2026-07-16T00:00:03.000Z'),
    })
    assert.equal(deliveredSecond.status, 'DELIVERED')
    assert.equal((await readQueueSnapshot(dataDirectory)).length, 0)
  } finally {
    await api.close()
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

test('queue recovers a partial tail and dead-letters capacity overflow', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aisidequest-queue-'))
  const now = new Date('2026-07-16T00:00:00.000Z')
  const policy = {
    maxItems: 2,
    maxBytes: 1024 * 1024,
    retentionMs: 48 * 60 * 60 * 1_000,
    deadLetterMaxItems: 10,
    deadLetterMaxBytes: 1024 * 1024,
    deadLetterRetentionMs: 7 * 24 * 60 * 60 * 1_000,
  }

  try {
    const first = createEvent('UserPromptSubmit', 1, now)
    const second = createEvent('PermissionRequest', 1, now)
    const overflow = createEvent('Stop', 1, now)

    await enqueueEvent(first, dataDirectory, { now, policy })
    await enqueueEvent(second, dataDirectory, { now, policy })
    const result = await enqueueEvent(overflow, dataDirectory, { now, policy })

    assert.equal(result.queued, false)
    assert.deepEqual(
      (await readQueueSnapshot(dataDirectory)).map((item) => item.event.event),
      ['UserPromptSubmit', 'PermissionRequest'],
    )
    const deadLetters = await readDeadLetterSnapshot(dataDirectory)
    assert.equal(deadLetters.length, 1)
    assert.equal(deadLetters[0].reason, 'QUEUE_CAPACITY_EXCEEDED')
    assert.equal(deadLetters[0].event.eventId, overflow.eventId)

    await appendFile(resolveQueueFilePath(dataDirectory), '{partial', 'utf8')
    assert.deepEqual(
      (await readQueueSnapshot(dataDirectory)).map((item) => item.event.eventId),
      [first.eventId, second.eventId],
    )
  } finally {
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

test('heartbeat is queued every 30 seconds and stops with the turn or host', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aisidequest-heartbeat-'))
  const startedAt = new Date('2026-07-16T00:00:00.000Z')
  const start = createEvent('UserPromptSubmit', 1, startedAt)

  try {
    await updateHeartbeatState(start, dataDirectory, {
      environment: { AISIDEQUEST_HOST_PID: String(process.pid) },
      now: startedAt,
    })

    const early = await enqueueDueHeartbeat(dataDirectory, {
      now: new Date('2026-07-16T00:00:29.999Z'),
    })
    assert.equal(early.enqueued, false)

    const due = await enqueueDueHeartbeat(dataDirectory, {
      now: new Date('2026-07-16T00:00:30.000Z'),
    })
    assert.equal(due.enqueued, true)
    assert.equal(
      (await readQueueSnapshot(dataDirectory))[0].event.event,
      'Heartbeat',
    )

    await updateHeartbeatState(
      { ...start, event: 'Stop', eventId: randomUUID() },
      dataDirectory,
      { now: new Date('2026-07-16T00:00:31.000Z') },
    )
    const afterStop = await enqueueDueHeartbeat(dataDirectory, {
      now: new Date('2026-07-16T00:01:00.000Z'),
    })
    assert.equal(afterStop.active, false)

    await updateHeartbeatState(start, dataDirectory, {
      environment: { AISIDEQUEST_HOST_PID: '999999999' },
      now: new Date('2026-07-16T01:00:00.000Z'),
    })
    const stoppedHost = await enqueueDueHeartbeat(dataDirectory, {
      now: new Date('2026-07-16T01:00:30.000Z'),
      processAlive: () => false,
    })
    assert.equal(stoppedHost.active, false)
  } finally {
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

test('keeps a local event and exits successfully when no device is connected', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'aisidequest-plugin-'))
  const environment = { AISIDEQUEST_DATA_DIR: dataDirectory }

  try {
    await runRecorder(
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'manual-fallback-session',
        turn_id: 'manual-fallback-turn',
        prompt: 'must not be persisted',
      },
      environment,
    )

    const log = await readFile(join(dataDirectory, 'events.jsonl'), 'utf8')
    const event = JSON.parse(log.trim())

    assert.equal(event.event, 'UserPromptSubmit')
    assert.doesNotMatch(log, /must not be persisted|prompt/)
  } finally {
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
