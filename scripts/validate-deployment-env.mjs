import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const REQUIRED_KEYS = [
  'NODE_ENV',
  'DEPLOYMENT_ENVIRONMENT',
  'SERVICE_VERSION',
  'API_HOST',
  'API_PORT',
  'CORS_ORIGIN',
  'DATABASE_URL',
  'DATABASE_SSL',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_CALLBACK_URL',
  'AUTH_SUCCESS_REDIRECT_URL',
  'AUTH_FAILURE_REDIRECT_URL',
  'METRICS_BEARER_TOKEN',
  'TRUST_PROXY_HOPS',
  'INTEGRATION_EVENTS_ENABLED',
  'QUEST_REWARDS_ENABLED',
  'SITE_ADDRESS',
  'AISIDEQUEST_API_IMAGE',
  'AISIDEQUEST_WEB_IMAGE',
]

const DIGEST_IMAGE = /^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/
const PLACEHOLDER = /(replace|change[-_ ]?me|example|localhost|127\.0\.0\.1)/i

export function parseEnvironmentFile(source) {
  const values = {}
  for (const [index, sourceLine] of source.split(/\r?\n/u).entries()) {
    const line = sourceLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) throw new Error(`line ${index + 1} is not KEY=VALUE`)
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (Object.hasOwn(values, key)) throw new Error(`${key} is defined more than once`)
    values[key] = value
  }
  return values
}

function assertHttpsUrl(value, name) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS`)
  if (parsed.username || parsed.password) throw new Error(`${name} must not include credentials`)
  return parsed
}

export function validateDeploymentEnvironment(values, expectedEnvironment) {
  const errors = []
  const check = (condition, message) => {
    if (!condition) errors.push(message)
  }

  for (const key of REQUIRED_KEYS) check(Boolean(values[key]), `${key} is required`)
  check(values.NODE_ENV === 'production', 'NODE_ENV must be production')
  check(values.DEPLOYMENT_ENVIRONMENT === expectedEnvironment, `DEPLOYMENT_ENVIRONMENT must be ${expectedEnvironment}`)
  check(['staging', 'production'].includes(expectedEnvironment), 'expected environment must be staging or production')
  check(values.SERVICE_VERSION !== '0.1.0' && !PLACEHOLDER.test(values.SERVICE_VERSION ?? ''), 'SERVICE_VERSION must identify an immutable build')
  check(values.API_HOST === '0.0.0.0', 'API_HOST must listen inside the container on 0.0.0.0')
  check(values.API_PORT === '3000', 'API_PORT must be 3000 for the deployment image')
  check(values.DATABASE_SSL === 'true', 'DATABASE_SSL must be true')
  check(values.TRUST_PROXY_HOPS === '1', 'TRUST_PROXY_HOPS must be 1 behind the bundled reverse proxy')
  check(['true', 'false'].includes(values.INTEGRATION_EVENTS_ENABLED), 'INTEGRATION_EVENTS_ENABLED must be explicit')
  check(['true', 'false'].includes(values.QUEST_REWARDS_ENABLED), 'QUEST_REWARDS_ENABLED must be explicit')
  check((values.METRICS_BEARER_TOKEN?.length ?? 0) >= 32 && !PLACEHOLDER.test(values.METRICS_BEARER_TOKEN ?? ''), 'METRICS_BEARER_TOKEN must be a non-placeholder secret of at least 32 characters')
  check((values.GITHUB_CLIENT_ID?.length ?? 0) >= 8 && !PLACEHOLDER.test(values.GITHUB_CLIENT_ID ?? ''), 'GITHUB_CLIENT_ID must not be a placeholder')
  check((values.GITHUB_CLIENT_SECRET?.length ?? 0) >= 20 && !PLACEHOLDER.test(values.GITHUB_CLIENT_SECRET ?? ''), 'GITHUB_CLIENT_SECRET must not be a placeholder')
  const discoverToken = values.GITHUB_DISCOVER_TOKEN ?? ''
  const discoverOrganizations = values.GITHUB_DISCOVER_ORGANIZATIONS ?? ''
  const discoverRepositories = values.GITHUB_DISCOVER_REPOSITORIES ?? ''
  const hasDiscoverScopes = Boolean(discoverOrganizations || discoverRepositories)
  check(Boolean(discoverToken) === hasDiscoverScopes, 'GitHub Discover token and approved scopes must be configured together')
  if (discoverToken) {
    check(discoverToken.length >= 20 && !PLACEHOLDER.test(discoverToken), 'GITHUB_DISCOVER_TOKEN must be a non-placeholder server-only secret')
    check(
      discoverOrganizations.split(',').filter(Boolean).every((value) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value.trim())),
      'GITHUB_DISCOVER_ORGANIZATIONS must contain valid comma-separated organizations',
    )
    check(
      discoverRepositories.split(',').filter(Boolean).every((value) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(value.trim())),
      'GITHUB_DISCOVER_REPOSITORIES must contain valid owner/repository values',
    )
  }
  check(DIGEST_IMAGE.test(values.AISIDEQUEST_API_IMAGE ?? ''), 'AISIDEQUEST_API_IMAGE must be pinned by sha256 digest')
  check(DIGEST_IMAGE.test(values.AISIDEQUEST_WEB_IMAGE ?? ''), 'AISIDEQUEST_WEB_IMAGE must be pinned by sha256 digest')

  try {
    const database = new URL(values.DATABASE_URL)
    check(['postgres:', 'postgresql:'].includes(database.protocol), 'DATABASE_URL must use PostgreSQL')
    check(Boolean(database.username && database.password && database.pathname !== '/'), 'DATABASE_URL must include database-specific credentials and a database name')
    check(!PLACEHOLDER.test(values.DATABASE_URL), 'DATABASE_URL must not contain local or placeholder values')
  } catch {
    errors.push('DATABASE_URL must be a valid PostgreSQL URL')
  }

  try {
    const origin = assertHttpsUrl(values.CORS_ORIGIN, 'CORS_ORIGIN')
    const callback = assertHttpsUrl(values.GITHUB_CALLBACK_URL, 'GITHUB_CALLBACK_URL')
    const success = assertHttpsUrl(values.AUTH_SUCCESS_REDIRECT_URL, 'AUTH_SUCCESS_REDIRECT_URL')
    const failure = assertHttpsUrl(values.AUTH_FAILURE_REDIRECT_URL, 'AUTH_FAILURE_REDIRECT_URL')
    check(callback.origin === origin.origin, 'GitHub callback must share the public origin')
    check(callback.pathname === '/api/v1/auth/github/callback', 'GitHub callback path must be exact')
    check(success.origin === origin.origin && failure.origin === origin.origin, 'auth redirects must remain on the public origin')
    check(values.SITE_ADDRESS === origin.hostname, 'SITE_ADDRESS must match the public hostname')
    check(!PLACEHOLDER.test(origin.hostname), 'public hostname must not be a placeholder or local address')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'public URLs are invalid')
  }

  return errors
}

export function validateEnvironmentSeparation(staging, production) {
  const errors = []
  for (const key of ['CORS_ORIGIN', 'DATABASE_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'METRICS_BEARER_TOKEN', 'SITE_ADDRESS']) {
    if (staging[key] === production[key]) errors.push(`${key} must differ between staging and production`)
  }
  if (staging.GITHUB_DISCOVER_TOKEN && staging.GITHUB_DISCOVER_TOKEN === production.GITHUB_DISCOVER_TOKEN) {
    errors.push('GITHUB_DISCOVER_TOKEN must differ between staging and production')
  }
  for (const key of ['SERVICE_VERSION', 'AISIDEQUEST_API_IMAGE', 'AISIDEQUEST_WEB_IMAGE']) {
    if (staging[key] !== production[key]) errors.push(`${key} must be identical when promoting a release`)
  }
  return errors
}

async function main() {
  const [expectedEnvironment, filePath, productionFilePath] = process.argv.slice(2)
  if (!expectedEnvironment || !filePath) {
    throw new Error('usage: node scripts/validate-deployment-env.mjs <staging|production> <env-file> [production-env-file]')
  }
  const values = parseEnvironmentFile(await readFile(filePath, 'utf8'))
  const errors = validateDeploymentEnvironment(values, expectedEnvironment)
  if (productionFilePath) {
    const production = parseEnvironmentFile(await readFile(productionFilePath, 'utf8'))
    errors.push(...validateDeploymentEnvironment(production, 'production'))
    errors.push(...validateEnvironmentSeparation(values, production))
  }
  if (errors.length > 0) throw new Error(`deployment validation failed:\n- ${errors.join('\n- ')}`)
  process.stdout.write(`deployment configuration is valid for ${expectedEnvironment}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
