import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { connectDevice } from '../scripts/connect-device.mjs'
import { resolveConfigPath } from '../scripts/device-config.mjs'
import {
  hashIdentifier,
  sanitizeHookPayload,
} from '../scripts/event-recorder.mjs'
import { sendTestEvent } from '../scripts/send-test-event.mjs'

const LINK_CODE = '123e4567-e89b-42d3-a456-426614174000'

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
