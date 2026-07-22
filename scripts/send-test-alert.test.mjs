import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'

import { sendTestAlert } from './send-test-alert.mjs'

test('delivers a privacy-safe staging alert to the configured route', async () => {
  let received
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      received = JSON.parse(body)
      response.writeHead(204).end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.equal(typeof address, 'object')
    const result = await sendTestAlert({
      webhookUrl: `http://127.0.0.1:${address.port}/alerts`,
      environment: 'staging',
    })
    assert.deepEqual(result, { delivered: true, status: 204 })
    assert.equal(received.event, 'AISideQuestAlertPipelineTest')
    assert.equal(received.environment, 'staging')
    assert.deepEqual(Object.keys(received).sort(), [
      'environment', 'event', 'sentAt', 'severity',
    ])
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('rejects cleartext non-local alert destinations', async () => {
  await assert.rejects(
    sendTestAlert({ webhookUrl: 'http://alerts.example.com/hook' }),
    /must use HTTPS/,
  )
})

test('alert rules contain every required operational signal and runbook link', async () => {
  const rules = await readFile(new URL('../ops/prometheus-alerts.yml', import.meta.url), 'utf8')
  for (const alert of [
    'AISideQuestReadinessDown',
    'AISideQuestHigh5xxRate',
    'AISideQuestHeartbeatExpirationHigh',
    'AISideQuestDeferredEventOld',
    'AISideQuestPluginQueueBacklog',
    'AISideQuestDatabasePoolWaiting',
    'AISideQuestAuthFailureBurst',
    'AISideQuestRateLimitBurst',
    'AISideQuestDiscoverSourceFailure',
    'AISideQuestDiscoverSourceUnavailable',
    'AISideQuestDiscoverSourceLatencyHigh',
  ]) {
    assert.match(rules, new RegExp(`alert: ${alert}`))
  }
  assert.doesNotMatch(rules, /\t/)
  assert.equal((rules.match(/runbook:/g) ?? []).length, 12)
})
