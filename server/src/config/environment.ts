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

function parseCorsOrigin(value: unknown) {
  const origin = readNonEmptyString(value, DEFAULT_ENVIRONMENT.CORS_ORIGIN)

  try {
    const parsedOrigin = new URL(origin)

    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
      throw new Error('unsupported protocol')
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
  const corsOrigin = parseCorsOrigin(configuration.CORS_ORIGIN)

  assertCompatibleAuthCookieHost(authEnvironment, corsOrigin)

  return {
    ...configuration,
    ...readDatabaseEnvironment(configuration),
    ...authEnvironment,
    NODE_ENV: nodeEnvironment,
    API_HOST: readNonEmptyString(
      configuration.API_HOST,
      DEFAULT_ENVIRONMENT.API_HOST,
    ),
    API_PORT: parsePort(configuration.API_PORT),
    CORS_ORIGIN: corsOrigin,
  }
}
