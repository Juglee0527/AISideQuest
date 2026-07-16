import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'

import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { DataSource } from 'typeorm'

import { AppModule } from '../../src/app.module'
import { hashToken } from '../../src/auth/auth-crypto'
import { configureApplication } from '../../src/bootstrap/configure-application'
import { validateEnvironment } from '../../src/config/environment'
import { createDataSourceOptions } from '../../src/database/data-source'
import { DatabaseService } from '../../src/database/database.service'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const databaseResetAllowed = process.env.ALLOW_DATABASE_RESET === 'true'

interface TestIdentity {
  userId: string
  sessionToken: string
  csrfToken: string
}

interface LinkedDevice {
  id: string
  token: string
}

function cookieHeader(identity: TestIdentity) {
  return [
    `aisidequest_session=${identity.sessionToken}`,
    `aisidequest_csrf=${identity.csrfToken}`,
  ].join('; ')
}

if (!testDatabaseUrl || !databaseResetAllowed) {
  test(
    'device integration tests require an explicitly resettable test database',
    { skip: 'Set TEST_DATABASE_URL and ALLOW_DATABASE_RESET=true' },
    () => undefined,
  )
} else {
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1)
  const environment = {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl,
    DATABASE_SSL: 'false',
    GITHUB_CLIENT_ID: 'test-github-client',
    GITHUB_CLIENT_SECRET: 'test-github-secret',
    GITHUB_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/github/callback',
    AUTH_SUCCESS_REDIRECT_URL: 'http://localhost:5173/',
    AUTH_FAILURE_REDIRECT_URL:
      'http://localhost:5173/?authError=github_oauth_failed',
    AUTH_SESSION_TTL_HOURS: '168',
  }
  const firstIdentity: TestIdentity = {
    userId: '',
    sessionToken: 'device-first-session-token',
    csrfToken: 'device-first-csrf-token',
  }
  const secondIdentity: TestIdentity = {
    userId: '',
    sessionToken: 'device-second-session-token',
    csrfToken: 'device-second-csrf-token',
  }
  let app: INestApplication
  let databaseService: DatabaseService

  before(async () => {
    assert.match(databaseName, /test/i)

    const setupDataSource = new DataSource(
      createDataSourceOptions({
        DATABASE_URL: testDatabaseUrl,
        DATABASE_SSL: false,
      }),
    )
    await setupDataSource.initialize()
    await setupDataSource.dropDatabase()
    await setupDataSource.runMigrations()
    await setupDataSource.destroy()

    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(validateEnvironment(environment)))
      .compile()

    app = testingModule.createNestApplication()
    configureApplication(app)
    await app.init()
    databaseService = app.get(DatabaseService)

    const users = await databaseService.query<Array<{ id: string }>>(`
      INSERT INTO users (display_name)
      VALUES ('First device user'), ('Second device user')
      RETURNING id
    `)
    firstIdentity.userId = users[0].id
    secondIdentity.userId = users[1].id

    await databaseService.query(
      `
        INSERT INTO user_auth_accounts (
          user_id, provider, provider_account_id, provider_login
        )
        VALUES
          ($1, 'GITHUB', 'device-user-1', 'device-user-1'),
          ($2, 'GITHUB', 'device-user-2', 'device-user-2')
      `,
      [firstIdentity.userId, secondIdentity.userId],
    )

    await databaseService.query(
      `
        INSERT INTO auth_sessions (
          user_id, token_hash, csrf_token_hash, expires_at
        )
        VALUES
          ($1, $2, $3, now() + interval '1 day'),
          ($4, $5, $6, now() + interval '1 day')
      `,
      [
        firstIdentity.userId,
        hashToken(firstIdentity.sessionToken),
        hashToken(firstIdentity.csrfToken),
        secondIdentity.userId,
        hashToken(secondIdentity.sessionToken),
        hashToken(secondIdentity.csrfToken),
      ],
    )
  })

  beforeEach(async () => {
    await databaseService.query(`
      DELETE FROM integration_events;
      DELETE FROM device_link_codes;
      DELETE FROM api_idempotency_keys;
      DELETE FROM devices;
    `)
  })

  after(async () => {
    await app?.close()
  })

  function createLink(
    identity: TestIdentity,
    code: string,
    idempotencyKey = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/device-links')
      .set('Cookie', cookieHeader(identity))
      .set('x-csrf-token', identity.csrfToken)
      .set('Idempotency-Key', idempotencyKey)
      .send({ code })
  }

  function redeemLink(
    code: string,
    token: string,
    idempotencyKey = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/device-links/redeem')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        code,
        deviceToken: token,
        deviceName: 'Windows Codex',
        pluginVersion: '0.1.0',
      })
  }

  async function linkDevice(identity: TestIdentity): Promise<LinkedDevice> {
    const code = randomUUID()
    const token = randomBytes(32).toString('base64url')

    await createLink(identity, code).expect(200)
    const response = await redeemLink(code, token).expect(200)

    return { id: response.body.data.device.id, token }
  }

  function sendTestEvent(token: string) {
    const eventId = randomUUID()

    return request(app.getHttpServer())
      .post('/api/v1/integration-events')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', eventId)
      .send({
        schemaVersion: 1,
        eventId,
        provider: 'CODEX',
        event: 'SessionStart',
        sessionKey: 'a'.repeat(64),
        observedAt: new Date().toISOString(),
      })
  }

  test('link creation requires authentication, CSRF and idempotency', async () => {
    const code = randomUUID()

    await request(app.getHttpServer())
      .post('/api/v1/device-links')
      .set('Idempotency-Key', randomUUID())
      .send({ code })
      .expect(401)

    await request(app.getHttpServer())
      .post('/api/v1/device-links')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('Idempotency-Key', randomUUID())
      .send({ code })
      .expect(403)

    const missingKey = await request(app.getHttpServer())
      .post('/api/v1/device-links')
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .send({ code })
      .expect(400)

    assert.equal(missingKey.body.error.code, 'VALIDATION_ERROR')
  })

  test('stores only hashes and replays one redemption exactly once', async () => {
    const code = randomUUID()
    const token = randomBytes(32).toString('base64url')
    const createKey = randomUUID()
    const redeemKey = randomUUID()
    const firstLink = await createLink(firstIdentity, code, createKey).expect(200)
    const replayedLink = await createLink(firstIdentity, code, createKey).expect(200)

    assert.deepEqual(replayedLink.body.data, firstLink.body.data)

    const firstRedeem = await redeemLink(code, token, redeemKey).expect(200)
    const replayedRedeem = await redeemLink(code, token, redeemKey).expect(200)

    assert.deepEqual(replayedRedeem.body.data, firstRedeem.body.data)
    await redeemLink(code, token, randomUUID()).expect(401)

    const [stored] = await databaseService.query<Array<{
      code_hash: string
      token_hash: string
      devices: number
    }>>(`
      SELECT
        device_link_codes.code_hash,
        devices.token_hash,
        (SELECT count(*)::integer FROM devices) AS devices
      FROM device_link_codes
      JOIN devices ON devices.user_id = device_link_codes.user_id
    `)

    assert.equal(stored.code_hash, hashToken(code))
    assert.equal(stored.token_hash, hashToken(token))
    assert.notEqual(stored.code_hash, code)
    assert.notEqual(stored.token_hash, token)
    assert.equal(stored.devices, 1)
  })

  test('isolates owners and rotates a token before accepting a test event', async () => {
    const device = await linkDevice(firstIdentity)
    const firstList = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('Cookie', cookieHeader(firstIdentity))
      .expect(200)
    const secondList = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('Cookie', cookieHeader(secondIdentity))
      .expect(200)

    assert.equal(firstList.body.data.items.length, 1)
    assert.equal(secondList.body.data.items.length, 0)

    await request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/rotation-links`)
      .set('Cookie', cookieHeader(secondIdentity))
      .set('x-csrf-token', secondIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ code: randomUUID() })
      .expect(404)

    const rotationCode = randomUUID()
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/rotation-links`)
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ code: rotationCode })
      .expect(200)

    const rotatedToken = randomBytes(32).toString('base64url')
    await redeemLink(rotationCode, rotatedToken).expect(200)
    await sendTestEvent(device.token).expect(401)

    const eventResponse = await sendTestEvent(rotatedToken).expect(200)
    assert.equal(eventResponse.body.data.result, 'APPLIED')
    assert.equal(eventResponse.body.data.session, null)

    const [storedDevice] = await databaseService.query<
      Array<{ token_hash: string; last_seen_at: Date | null }>
    >('SELECT token_hash, last_seen_at FROM devices WHERE id = $1', [device.id])

    assert.equal(storedDevice.token_hash, hashToken(rotatedToken))
    assert.ok(storedDevice.last_seen_at instanceof Date)
  })

  test('revocation is idempotent and immediately blocks device authentication', async () => {
    const device = await linkDevice(firstIdentity)
    const idempotencyKey = randomUUID()
    const revokeRequest = () => request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/revoke`)
      .set('Cookie', cookieHeader(firstIdentity))
      .set('x-csrf-token', firstIdentity.csrfToken)
      .set('Idempotency-Key', idempotencyKey)

    const first = await revokeRequest().expect(200)
    const replay = await revokeRequest().expect(200)

    assert.deepEqual(replay.body.data, first.body.data)
    assert.ok(first.body.data.device.revokedAt)
    await sendTestEvent(device.token).expect(401)
  })
}
