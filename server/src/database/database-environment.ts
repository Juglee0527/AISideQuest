export interface DatabaseEnvironment {
  DATABASE_URL: string
  DATABASE_SSL: boolean
}

const DEFAULT_DATABASE_URL =
  'postgresql://aisidequest:aisidequest@127.0.0.1:54329/aisidequest'

function parseDatabaseUrl(value: unknown) {
  const databaseUrl =
    typeof value === 'string' && value.trim() !== ''
      ? value.trim()
      : DEFAULT_DATABASE_URL

  try {
    const parsedUrl = new URL(databaseUrl)

    if (
      parsedUrl.protocol !== 'postgresql:' &&
      parsedUrl.protocol !== 'postgres:'
    ) {
      throw new Error('unsupported protocol')
    }

    if (!parsedUrl.hostname || parsedUrl.pathname === '/') {
      throw new Error('host and database are required')
    }

    return databaseUrl
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL')
  }
}

function parseDatabaseSsl(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return false
  }

  if (value === true || value === 'true') {
    return true
  }

  if (value === false || value === 'false') {
    return false
  }

  throw new Error('DATABASE_SSL must be true or false')
}

export function readDatabaseEnvironment(
  configuration: Record<string, unknown>,
): DatabaseEnvironment {
  return {
    DATABASE_URL: parseDatabaseUrl(configuration.DATABASE_URL),
    DATABASE_SSL: parseDatabaseSsl(configuration.DATABASE_SSL),
  }
}
