import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseEnvironmentFile,
  validateDeploymentEnvironment,
  validateEnvironmentSeparation,
} from './validate-deployment-env.mjs'

function valid(environment, host) {
  const digest = 'a'.repeat(64)
  return {
    NODE_ENV: 'production', DEPLOYMENT_ENVIRONMENT: environment,
    SERVICE_VERSION: 'git-0123456789abcdef', API_HOST: '0.0.0.0', API_PORT: '3000',
    CORS_ORIGIN: `https://${host}`,
    DATABASE_URL: `postgresql://user_${environment}:secret_${environment}@db-${environment}.internal:5432/aisidequest`,
    DATABASE_SSL: 'true', GITHUB_CLIENT_ID: `github-id-${environment}`,
    GITHUB_CLIENT_SECRET: `github-secret-${environment}-123456789`,
    GITHUB_CALLBACK_URL: `https://${host}/api/v1/auth/github/callback`,
    AUTH_SUCCESS_REDIRECT_URL: `https://${host}/`,
    AUTH_FAILURE_REDIRECT_URL: `https://${host}/?authError=github_oauth_failed`,
    METRICS_BEARER_TOKEN: `metrics-${environment}-${'z'.repeat(40)}`,
    TRUST_PROXY_HOPS: '1', INTEGRATION_EVENTS_ENABLED: 'true', QUEST_REWARDS_ENABLED: 'true',
    SITE_ADDRESS: host,
    AISIDEQUEST_API_IMAGE: `ghcr.io/owner/aisidequest/api@sha256:${digest}`,
    AISIDEQUEST_WEB_IMAGE: `ghcr.io/owner/aisidequest/web@sha256:${digest}`,
  }
}

test('parses comments, quoted values, and embedded equals signs', () => {
  assert.deepEqual(parseEnvironmentFile('# comment\nA=one\nB="two=three"\n'), { A: 'one', B: 'two=three' })
})

test('accepts a complete digest-pinned production environment', () => {
  assert.deepEqual(validateDeploymentEnvironment(valid('production', 'app.company.test'), 'production'), [])
})

test('rejects plaintext origins, placeholders, mutable tags, and implicit switches', () => {
  const environment = valid('production', 'app.company.test')
  environment.CORS_ORIGIN = 'http://app.company.test'
  environment.GITHUB_CALLBACK_URL = 'http://app.company.test/api/v1/auth/github/callback'
  environment.AISIDEQUEST_API_IMAGE = 'ghcr.io/owner/app:latest'
  environment.GITHUB_CLIENT_SECRET = 'REPLACE_ME'
  delete environment.QUEST_REWARDS_ENABLED
  const errors = validateDeploymentEnvironment(environment, 'production')
  assert.ok(errors.some((error) => error.includes('HTTPS')))
  assert.ok(errors.some((error) => error.includes('sha256')))
  assert.ok(errors.some((error) => error.includes('GITHUB_CLIENT_SECRET')))
  assert.ok(errors.some((error) => error.includes('QUEST_REWARDS_ENABLED')))
})

test('requires isolated credentials and identical promoted artifacts', () => {
  const staging = valid('staging', 'staging.company.test')
  const production = valid('production', 'app.company.test')
  production.GITHUB_CLIENT_ID = staging.GITHUB_CLIENT_ID
  production.AISIDEQUEST_WEB_IMAGE = production.AISIDEQUEST_WEB_IMAGE.replace(/a{64}/, 'b'.repeat(64))
  const errors = validateEnvironmentSeparation(staging, production)
  assert.ok(errors.includes('GITHUB_CLIENT_ID must differ between staging and production'))
  assert.ok(errors.includes('AISIDEQUEST_WEB_IMAGE must be identical when promoting a release'))
})

