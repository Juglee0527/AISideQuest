import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { chromium } from 'playwright'

const baseUrl = (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/+$/, '')
const artifactDirectory = join(process.cwd(), 'e2e-artifacts')
const serverTime = '2026-07-18T00:00:00.000Z'
const sessionStartedAt = '2026-07-17T23:55:00.000Z'
const sessionId = '00000000-0000-4000-8000-000000000101'
const questId = '00000000-0000-4000-8000-000000000201'
const attemptId = '00000000-0000-4000-8000-000000000301'
const questionId = '00000000-0000-4000-8000-000000000401'
const correctOptionId = '00000000-0000-4000-8000-000000000501'
const wrongOptionId = '00000000-0000-4000-8000-000000000502'

let authenticated = false
let activeSession = null
let attempt = null
let points = 0

function envelope(data) {
  return { data, meta: { serverTime } }
}

function sessionFixture() {
  return {
    id: sessionId,
    provider: 'CODEX',
    status: 'RUNNING',
    origin: 'HOOK',
    autoLinked: true,
    startedAt: sessionStartedAt,
    endedAt: null,
    lastActivityAt: serverTime,
    durationMs: 300_000,
    terminalReason: null,
    timingQuality: 'EXACT',
    version: 1,
  }
}

function questFixture() {
  const completed = attempt?.status === 'COMPLETED'
  return {
    id: questId,
    code: 'http-idempotency',
    version: 1,
    title: 'HTTP Idempotency',
    description: 'Safely retry HTTP mutations.',
    estimatedMinutes: 3,
    rewardPoints: 100,
    passScore: 100,
    retryAllowed: true,
    completionStatus: completed ? 'PASSED' : attempt ? 'IN_PROGRESS' : 'NOT_STARTED',
    latestAttempt: attempt
      ? {
          id: attempt.id,
          status: attempt.status,
          score: attempt.result?.score ?? null,
          passed: attempt.result?.passed ?? null,
          startedAt: attempt.startedAt,
          completedAt: attempt.completedAt,
        }
      : null,
  }
}

function newAttempt() {
  return {
    id: attemptId,
    aiSessionId: sessionId,
    status: 'IN_PROGRESS',
    startedAt: serverTime,
    submittedAt: null,
    completedAt: null,
    submissionDeadline: null,
    canSubmit: true,
    canRetry: false,
    quest: {
      id: questId,
      code: 'http-idempotency',
      version: 1,
      title: 'HTTP Idempotency',
      passScore: 100,
      rewardPoints: 100,
      retryAllowed: true,
    },
    questions: [
      {
        id: questionId,
        position: 1,
        prompt: 'What makes a retried mutation safe?',
        selectedOptionId: null,
        options: [
          { id: correctOptionId, position: 1, label: 'A stable idempotency key' },
          { id: wrongOptionId, position: 2, label: 'A random request body' },
        ],
      },
    ],
    result: null,
  }
}

function pointEntry() {
  return {
    id: '00000000-0000-4000-8000-000000000601',
    attemptId,
    entryType: 'QUEST_REWARD',
    points: 100,
    description: 'Development quiz first-pass reward',
    createdAt: serverTime,
    quest: {
      id: questId,
      code: 'http-idempotency',
      version: 1,
      title: 'HTTP Idempotency',
    },
  }
}

function statisticsFixture(period) {
  return {
    period,
    asOf: serverTime,
    timeZone: { id: 'Asia/Seoul', verified: true },
    range: {
      startAt: '2026-07-17T15:00:00.000Z',
      endAt: '2026-07-18T15:00:00.000Z',
    },
    ai: { waitDurationMs: 300_000, sessionCount: 1, degradedSessionCount: 0 },
    quests: { completedCount: points === 100 ? 1 : 0 },
    points: { earned: points },
  }
}

async function run() {
  await rm(artifactDirectory, { recursive: true, force: true })
  await mkdir(artifactDirectory, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 900 },
  })
  await context.tracing.start({ screenshots: true, snapshots: true })
  const page = await context.newPage()

  const corsHeaders = {
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type,idempotency-key,x-csrf-token',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-origin': baseUrl,
    'content-type': 'application/json',
  }

  await context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace('/api/v1', '')
    const method = request.method()

    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' })
      return
    }

    if (path === '/auth/github' && method === 'GET') {
      authenticated = true
      await context.addCookies([
        { name: 'aisidequest_csrf', value: 'ci-fixture-csrf', url: baseUrl },
      ])
      await route.fulfill({ status: 302, headers: { location: `${baseUrl}/` }, body: '' })
      return
    }

    if (!authenticated) {
      await route.fulfill({
        status: 401,
        headers: corsHeaders,
        json: { error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }, meta: { serverTime } },
      })
      return
    }

    let data

    if (path === '/sessions/active' && method === 'GET') {
      data = activeSession
    } else if (path === '/sessions' && method === 'GET') {
      data = { items: [], nextCursor: null }
    } else if (path === '/devices' && method === 'GET') {
      data = {
        items: [{
          id: '00000000-0000-4000-8000-000000000701',
          name: 'Codex Desktop CI fixture',
          pluginVersion: '0.1.0',
          lastSeenAt: serverTime,
          expiresAt: '2026-07-19T00:00:00.000Z',
          revokedAt: null,
          createdAt: '2026-07-17T00:00:00.000Z',
        }],
      }
    } else if (path === '/points/balance' && method === 'GET') {
      data = { balance: points }
    } else if (path === '/points/ledger' && method === 'GET') {
      data = { items: points === 100 ? [pointEntry()] : [], nextCursor: null }
    } else if (path === '/quests' && method === 'GET') {
      data = { items: [questFixture()], nextCursor: null }
    } else if (path === '/quests/http-idempotency' && method === 'GET') {
      data = questFixture()
    } else if (path === '/quests/http-idempotency/attempts' && method === 'POST') {
      attempt ??= newAttempt()
      data = { created: true, attempt }
    } else if (path === `/quest-attempts/${attemptId}` && method === 'GET') {
      assert.ok(attempt, 'attempt must exist before it is restored')
      data = attempt
    } else if (path === `/quest-attempts/${attemptId}/answers` && method === 'PUT') {
      assert.ok(attempt)
      const payload = JSON.parse(request.postData() ?? '{}')
      const selected = payload.answers?.[0]?.selectedOptionId ?? null
      attempt = {
        ...attempt,
        questions: attempt.questions.map((question) => ({ ...question, selectedOptionId: selected })),
      }
      data = attempt
    } else if (path === `/quest-attempts/${attemptId}/submissions` && method === 'POST') {
      assert.equal(attempt?.questions[0]?.selectedOptionId, correctOptionId)
      attempt = {
        ...attempt,
        status: 'COMPLETED',
        submittedAt: serverTime,
        completedAt: serverTime,
        canSubmit: false,
        canRetry: false,
        result: { score: 100, passed: true, retryAllowed: false, answerReview: null },
      }
      points = 100
      data = {
        attempt,
        pointAward: { ledgerEntryId: pointEntry().id, points: 100 },
      }
    } else if (path === '/stats/summary' && method === 'GET') {
      data = statisticsFixture(url.searchParams.get('period') ?? 'today')
    } else {
      throw new Error(`Unhandled CI fixture request: ${method} ${path}`)
    }

    await route.fulfill({ status: 200, headers: corsHeaders, json: envelope(data) })
  })

  try {
    await page.goto(baseUrl)
    await page.getByTestId('github-login').waitFor()
    await page.getByTestId('github-login').click()
    await page.waitForURL(`${baseUrl}/`)

    await page.locator('a[href="/devices"]').first().click()
    await page.getByText('Codex Desktop CI fixture', { exact: true }).waitFor()

    activeSession = sessionFixture()
    await page.goto(`${baseUrl}/`)
    await page.getByTestId('session-start').waitFor()
    assert.equal(await page.getByTestId('session-start').isDisabled(), true)

    await page.locator('a[href="/quests"]').first().click()
    await page.getByText('HTTP Idempotency', { exact: true }).waitFor()
    await page.getByRole('link', { name: /HTTP Idempotency/ }).click()
    await page.getByTestId('attempt-start').click()
    await page.waitForURL(`${baseUrl}/quest-attempts/${attemptId}`)

    await page.getByTestId('answer-1-1').click()
    await page.waitForFunction(() => {
      const answer = document.querySelector('[data-testid="answer-1-1"]')
      return answer instanceof HTMLInputElement && answer.checked && !answer.disabled
    })
    assert.equal(await page.getByTestId('answer-1-1').isChecked(), true)

    await page.reload()
    await page.getByTestId('answer-1-1').waitFor()
    assert.equal(await page.getByTestId('answer-1-1').isChecked(), true)
    await page.getByTestId('attempt-submit').click()
    await page.getByTestId('attempt-submit-confirm').click()
    await page.getByText('100', { exact: false }).first().waitFor()

    await page.locator('a[href="/dashboard"]').first().click()
    await page.getByText('+100P', { exact: true }).waitFor()
    assert.match(await page.locator('body').innerText(), /100P/)

    await context.tracing.stop()
    process.stdout.write('Browser core flow passed with fixed time zone and sanitized fixtures.\n')
  } catch (error) {
    await page.screenshot({ path: join(artifactDirectory, 'core-flow-failure.png'), fullPage: true })
    await context.tracing.stop({ path: join(artifactDirectory, 'core-flow-trace.zip') })
    throw error
  } finally {
    await browser.close()
  }
}

await run()
