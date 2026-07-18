import {
  readDatabaseEnvironment,
  type DatabaseEnvironment,
} from '../database/database-environment'
import {
  readAuthEnvironment,
  type AuthEnvironment,
} from '../auth/auth-environment'

export type NodeEnvironment = 'development' | 'test' | 'production'

export interface AppEnvironment extends DatabaseEnvironment, AuthEnvironment {
  NODE_ENV: NodeEnvironment
  API_HOST: string
  API_PORT: number
  CORS_ORIGIN: string
  DEPLOYMENT_ENVIRONMENT: 'local' | 'staging' | 'production'
  SERVICE_VERSION: string
  OPERATIONAL_LOG_ENABLED: boolean
  METRICS_BEARER_TOKEN: string
  TRUST_PROXY_HOPS: number
}

const DEFAULT_ENVIRONMENT: Pick<
  AppEnvironment,
  'NODE_ENV' | 'API_HOST' | 'API_PORT' | 'CORS_ORIGIN'
> = {
  NODE_ENV: 'development',
  API_HOST: '127.0.0.1',
  API_PORT: 3000,
  CORS_ORIGIN: 'http://localhost:5173',
}

function readNonEmptyString(value: unknown, fallback: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback
  }

  return value.trim()
}

function parseNodeEnvironment(value: unknown): NodeEnvironment {
  const environment = readNonEmptyString(value, DEFAULT_ENVIRONMENT.NODE_ENV)

  if (
    environment !== 'development' &&
    environment !== 'test' &&
    environment !== 'production'
  ) {
    throw new Error('NODE_ENV must be development, test, or production')
  }

  return environment
}

function parsePort(value: unknown) {
  const rawPort = value ?? DEFAULT_ENVIRONMENT.API_PORT
  const port = typeof rawPort === 'number' ? rawPort : Number(rawPort)

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535')
  }

  return port
}

function parseBoolean(value: unknown, fallback: boolean, name: string) {
  if (value === undefined || value === null || value === '') return fallback
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function parseDeploymentEnvironment(value: unknown, nodeEnvironment: NodeEnvironment) {
  const fallback = nodeEnvironment === 'production' ? '' : 'local'
  const deployment = readNonEmptyString(value, fallback)
  if (!['local', 'staging', 'production'].includes(deployment)) {
    throw new Error('DEPLOYMENT_ENVIRONMENT must be local, staging, or production')
  }
  return deployment as AppEnvironment['DEPLOYMENT_ENVIRONMENT']
}

function parseTrustProxyHops(value: unknown, nodeEnvironment: NodeEnvironment) {
  const parsed = Number(value ?? 0)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3')
  }
  if (nodeEnvironment === 'production' && parsed === 0) {
    throw new Error('TRUST_PROXY_HOPS must be explicitly configured in production')
  }
  return parsed
}

function parseCorsOrigin(value: unknown, nodeEnvironment: NodeEnvironment) {
  const origin = readNonEmptyString(value, DEFAULT_ENVIRONMENT.CORS_ORIGIN)

  try {
    const parsedOrigin = new URL(origin)

    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }

    if (nodeEnvironment === 'production' && parsedOrigin.protocol !== 'https:') {
      throw new Error('production origin must use HTTPS')
    }

    return parsedOrigin.origin
  } catch {
    throw new Error('CORS_ORIGIN must be a valid HTTP or HTTPS origin')
  }
}

function assertCompatibleAuthCookieHost(
  authEnvironment: AuthEnvironment,
  corsOrigin: string,
) {
  const callbackHost = new URL(authEnvironment.GITHUB_CALLBACK_URL).hostname
  const clientHost = new URL(corsOrigin).hostname

  if (callbackHost !== clientHost) {
    throw new Error(
      'GITHUB_CALLBACK_URL and CORS_ORIGIN must use the same hostname for authentication cookies',
    )
  }
}

export function validateEnvironment(
  configuration: Record<string, unknown>,
): Record<string, unknown> & AppEnvironment {
  const nodeEnvironment = parseNodeEnvironment(configuration.NODE_ENV)
  const authEnvironment = readAuthEnvironment(configuration, nodeEnvironment)
  const corsOrigin = parseCorsOrigin(configuration.CORS_ORIGIN, nodeEnvironment)
  const databaseEnvironment = readDatabaseEnvironment(configuration)
  const deploymentEnvironment = parseDeploymentEnvironment(
    configuration.DEPLOYMENT_ENVIRONMENT,
    nodeEnvironment,
  )
  const serviceVersion = readNonEmptyString(configuration.SERVICE_VERSION, '0.1.0')
  const metricsToken = typeof configuration.METRICS_BEARER_TOKEN === 'string'
    ? configuration.METRICS_BEARER_TOKEN.trim()
    : ''

  if (nodeEnvironment === 'production') {
    const databaseUrl = new URL(databaseEnvironment.DATABASE_URL)
    if (!databaseEnvironment.DATABASE_SSL) {
      throw new Error('DATABASE_SSL must be true in production')
    }
    if (databaseUrl.password === 'aisidequest' || databaseUrl.hostname === '127.0.0.1') {
      throw new Error('production DATABASE_URL must not use local default credentials')
    }
    if (!configuration.SERVICE_VERSION || serviceVersion === '0.1.0') {
      throw new Error('SERVICE_VERSION must identify the deployed build in production')
    }
    if (metricsToken.length < 32) {
      throw new Error('METRICS_BEARER_TOKEN must contain at least 32 characters in production')
    }
  }

  assertCompatibleAuthCookieHost(authEnvironment, corsOrigin)

  return {
    ...configuration,
    ...databaseEnvironment,
    ...authEnvironment,
    NODE_ENV: nodeEnvironment,
    API_HOST: readNonEmptyString(
      configuration.API_HOST,
      DEFAULT_ENVIRONMENT.API_HOST,
    ),
    API_PORT: parsePort(configuration.API_PORT),
    CORS_ORIGIN: corsOrigin,
    DEPLOYMENT_ENVIRONMENT: deploymentEnvironment,
    SERVICE_VERSION: serviceVersion,
    OPERATIONAL_LOG_ENABLED: parseBoolean(
      configuration.OPERATIONAL_LOG_ENABLED,
      nodeEnvironment !== 'test',
      'OPERATIONAL_LOG_ENABLED',
    ),
    METRICS_BEARER_TOKEN: metricsToken,
    TRUST_PROXY_HOPS: parseTrustProxyHops(
      configuration.TRUST_PROXY_HOPS,
      nodeEnvironment,
    ),
  }
}
