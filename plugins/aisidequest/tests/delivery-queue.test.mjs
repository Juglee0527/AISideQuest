import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  enqueueEvent,
  processNextEvent,
  readDeliveryDiagnostic,
} from '../scripts/delivery-queue.mjs'
import { writeDeviceConfig } from '../scripts/device-config.mjs'

function event(name, id = randomUUID()) {
  return {
    schemaVersion: 1,
    eventId: id,
    provider: 'CODEX',
    event: name,
    sessionKey: 'a'.repeat(64),
    ...(name === 'SessionStart' ? {} : { turnKey: 'b'.repeat(64) }),
    observedAt: '2026-07-18T00:00:00.000Z',
  }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'aisidequest-queue-'))
  const environment = { AISIDEQUEST_DATA_DIR: directory }
  await writeDeviceConfig({
    apiUrl: 'http://127.0.0.1:3000/api/v1',
    deviceToken: 'test-device-token',
    pluginVersion: '0.1.0',
    device: { id: randomUUID(), name: 'Queue test' },
  }, environment)
  return { directory, environment }
}

function success(eventId) {
  return new Response(JSON.stringify({
    data: { eventId, result: 'APPLIED', session: null },
    meta: { serverTime: '2026-07-18T00:00:00.000Z' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

test('retries the same event id and drains events in FIFO sequence order', async () => {
  const { directory, environment } = await fixture()
  const first = event('UserPromptSubmit')
  const second = event('Stop')
  const received = []
  let failOnce = true

  try {
    const queuedFirst = await enqueueEvent(first, { environment })
    const queuedSecond = await enqueueEvent(second, { environment })
    assert.equal(queuedFirst.sequence, 1)
    assert.equal(queuedSecond.sequence, 2)

    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body)
      received.push({ eventId: body.eventId, sequence: body.sequence })
      if (failOnce) {
        failOnce = false
        throw new Error('offline')
      }
      return success(body.eventId)
    }

    const firstAttempt = await processNextEvent({ environment, fetchImpl, random: () => 0 })
    assert.equal(firstAttempt.status, 'WAIT')
    await processNextEvent({ environment, fetchImpl, random: () => 0 })
    await processNextEvent({ environment, fetchImpl, random: () => 0 })

    assert.deepEqual(received, [
      { eventId: first.eventId, sequence: 1 },
      { eventId: first.eventId, sequence: 1 },
      { eventId: second.eventId, sequence: 2 },
    ])
    assert.equal((await readDeliveryDiagnostic(environment)).queueDepth, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('moves permanent failures and corrupt queue records to dead letter storage', async () => {
  const { directory, environment } = await fixture()

  try {
    await writeFile(join(directory, 'delivery-queue.jsonl'), '{partial-json\n', 'utf8')
    const queued = await enqueueEvent(event('SessionStart'), { environment })
    const result = await processNextEvent({
      environment,
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { code: 'VALIDATION_ERROR' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    })

    assert.equal(result.status, 'DEAD_LETTERED')
    const deadLetters = (await readFile(join(directory, 'dead-letter.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(deadLetters.map((item) => item.reason), [
      'CORRUPT_QUEUE_RECORD',
      'PERMANENT_HTTP_ERROR',
    ])
    assert.equal(deadLetters[1].item.event.eventId, queued.eventId)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('stops automatic retries on authentication failures without acknowledging the event', async () => {
  const { directory, environment } = await fixture()

  try {
    await enqueueEvent(event('Heartbeat'), { environment })
    const result = await processNextEvent({
      environment,
      fetchImpl: async () => new Response(
        JSON.stringify({ error: { code: 'DEVICE_AUTH_REQUIRED' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    })
    const diagnostic = await readDeliveryDiagnostic(environment)

    assert.equal(result.status, 'AUTH_BLOCKED')
    assert.equal(diagnostic.status, 'AUTH_BLOCKED')
    assert.equal(diagnostic.queueDepth, 1)
    assert.equal(diagnostic.lastErrorCode, 'DEVICE_AUTH_REQUIRED')

    await writeFile(join(directory, 'delivery-diagnostic.json'), JSON.stringify({
      ...diagnostic,
      updatedAt: '2026-07-18T00:00:00.000Z',
    }), 'utf8')

    const recovered = await processNextEvent({
      environment,
      fetchImpl: async (_url, options) => success(JSON.parse(options.body).eventId),
    })
    const recoveredDiagnostic = await readDeliveryDiagnostic(environment)

    assert.equal(recovered.status, 'DELIVERED')
    assert.equal(recoveredDiagnostic.status, 'READY')
    assert.equal(recoveredDiagnostic.queueDepth, 0)
    assert.equal('lastErrorCode' in recoveredDiagnostic, false)
    assert.notEqual(recoveredDiagnostic.updatedAt, '2026-07-18T00:00:00.000Z')
    assert.equal(typeof recoveredDiagnostic.lastDeliveredAt, 'string')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('honors Retry-After, backs off on 5xx, and resumes after a simulated restart', async () => {
  const { directory, environment } = await fixture()
  const queued = event('Heartbeat')
  const startedAt = new Date('2026-07-18T00:00:00.000Z')
  let requests = 0

  try {
    await enqueueEvent(queued, { environment, now: startedAt })

    const fetchImpl = async () => {
      requests += 1

      if (requests === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'RATE_LIMITED' } }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '3',
            },
          },
        )
      }

      if (requests === 2) {
        return new Response(
          JSON.stringify({ error: { code: 'UPSTREAM_UNAVAILABLE' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        )
      }

      return success(queued.eventId)
    }

    const rateLimited = await processNextEvent({
      environment,
      fetchImpl,
      now: startedAt,
      random: () => 0.5,
    })
    assert.deepEqual(rateLimited, { status: 'WAIT', waitMs: 3_000 })

    const restartedTooEarly = await processNextEvent({
      environment,
      fetchImpl,
      now: new Date(startedAt.getTime() + 2_000),
      random: () => 0.5,
    })
    assert.deepEqual(restartedTooEarly, { status: 'WAIT', waitMs: 1_000 })
    assert.equal(requests, 1)

    const unavailable = await processNextEvent({
      environment,
      fetchImpl,
      now: new Date(startedAt.getTime() + 3_000),
      random: () => 0.5,
    })
    assert.deepEqual(unavailable, { status: 'WAIT', waitMs: 1_000 })

    const delivered = await processNextEvent({
      environment,
      fetchImpl,
      now: new Date(startedAt.getTime() + 4_000),
      random: () => 0.5,
    })
    assert.deepEqual(delivered, { status: 'DELIVERED', waitMs: 0 })
    assert.equal(requests, 3)
    assert.equal((await readDeliveryDiagnostic(environment)).queueDepth, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
