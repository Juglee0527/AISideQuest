import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import test from 'node:test'

import {
  assertLocalEnvironment,
  assertPortAvailable,
  localServiceSpecs,
  npmInvocation,
  prepareLocalEnvironment,
  waitForEndpoint,
} from './dev-local.mjs'

test('selects the platform npm executable and direct Node service commands', () => {
  assert.deepEqual(npmInvocation('win32', { ComSpec: 'cmd-test.exe' }), {
    command: 'cmd-test.exe',
    args: ['/d', '/s', '/c', 'npm.cmd'],
  })
  assert.deepEqual(npmInvocation('linux'), { command: 'npm', args: [] })
  assert.deepEqual(localServiceSpecs('node-test'), [
    {
      label: 'API',
      command: 'node-test',
      args: ['--enable-source-maps', 'server/dist/main.js'],
    },
    {
      label: 'WEB',
      command: 'node-test',
      args: ['node_modules/vite/bin/vite.js', '--strictPort'],
    },
  ])
})

test('requires an explicit local environment file', async () => {
  await assert.rejects(
    assertLocalEnvironment({ accessImpl: async () => { throw new Error('missing') } }),
    /\.env 파일이 없습니다/,
  )
})

test('starts PostgreSQL before applying migrations and seed data', async () => {
  const calls = []

  await prepareLocalEnvironment({
    platform: 'win32',
    accessImpl: async () => undefined,
    assertPortsImpl: async () => undefined,
    runCommandImpl: async (command, args) => calls.push([command, ...args]),
  })

  assert.deepEqual(calls, [
    [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', 'npm.cmd', 'run', 'db:up'],
    [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', 'npm.cmd', 'run', 'db:setup'],
  ])
})

test('retries service readiness until an endpoint succeeds', async () => {
  let attempts = 0
  let delays = 0

  await waitForEndpoint('http://localhost:5173/', {
    fetchImpl: async () => ({ ok: ++attempts === 3 }),
    delayImpl: async () => { delays += 1 },
    timeoutMs: 1_000,
  })

  assert.equal(attempts, 3)
  assert.equal(delays, 2)
})

test('rejects an occupied local service port instead of selecting another port', async () => {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  try {
    assert.equal(typeof address, 'object')
    await assert.rejects(
      assertPortAvailable(address.port, '127.0.0.1'),
      new RegExp(`로컬 포트 ${address.port}이 이미 사용 중`),
    )
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
})
