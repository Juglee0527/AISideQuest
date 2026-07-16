import type { NodeEnvironment } from '../config/environment'

export interface AuthEnvironment {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  GITHUB_CALLBACK_URL: string
  AUTH_SUCCESS_REDIRECT_URL: string
  AUTH_FAILURE_REDIRECT_URL: string
  AUTH_SESSION_TTL_HOURS: number
}

const DEFAULT_GITHUB_CALLBACK_URL =
  'http://localhost:3000/api/v1/auth/github/callback'
const DEFAULT_AUTH_SUCCESS_REDIRECT_URL = 'http://localhost:5173/'
const DEFAULT_AUTH_FAILURE_REDIRECT_URL =
  'http://localhost:5173/?authError=github_oauth_failed'

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseHttpUrl(
  value: unknown,
  fallback: string,
  name: string,
  nodeEnvironment: NodeEnvironment,
) {
  const rawUrl = readOptionalString(value) || fallback

  try {
    const parsedUrl = new URL(rawUrl)

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }

    if (nodeEnvironment === 'production' && parsedUrl.protocol !== 'https:') {
      throw new Error('HTTPS required')
    }

    return parsedUrl.toString()
  } catch {
    throw new Error(
      `${name} must be a valid ${
        nodeEnvironment === 'production' ? 'HTTPS' : 'HTTP or HTTPS'
      } URL`,
    )
  }
}

function parseSessionTtlHours(value: unknown) {
  const rawValue = value ?? 168
  const ttlHours = typeof rawValue === 'number' ? rawValue : Number(rawValue)

  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 720) {
    throw new Error('AUTH_SESSION_TTL_HOURS must be an integer from 1 to 720')
  }

  return ttlHours
}

export function readAuthEnvironment(
  configuration: Record<string, unknown>,
  nodeEnvironment: NodeEnvironment,
): AuthEnvironment {
  const clientId = readOptionalString(configuration.GITHUB_CLIENT_ID)
  const clientSecret = readOptionalString(configuration.GITHUB_CLIENT_SECRET)

  if (nodeEnvironment === 'production' && (!clientId || !clientSecret)) {
    throw new Error(
      'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required in production',
    )
  }

  return {
    GITHUB_CLIENT_ID: clientId,
    GITHUB_CLIENT_SECRET: clientSecret,
    GITHUB_CALLBACK_URL: parseHttpUrl(
      configuration.GITHUB_CALLBACK_URL,
      DEFAULT_GITHUB_CALLBACK_URL,
      'GITHUB_CALLBACK_URL',
      nodeEnvironment,
    ),
    AUTH_SUCCESS_REDIRECT_URL: parseHttpUrl(
      configuration.AUTH_SUCCESS_REDIRECT_URL,
      DEFAULT_AUTH_SUCCESS_REDIRECT_URL,
      'AUTH_SUCCESS_REDIRECT_URL',
      nodeEnvironment,
    ),
    AUTH_FAILURE_REDIRECT_URL: parseHttpUrl(
      configuration.AUTH_FAILURE_REDIRECT_URL,
      DEFAULT_AUTH_FAILURE_REDIRECT_URL,
      'AUTH_FAILURE_REDIRECT_URL',
      nodeEnvironment,
    ),
    AUTH_SESSION_TTL_HOURS: parseSessionTtlHours(
      configuration.AUTH_SESSION_TTL_HOURS,
    ),
  }
}
