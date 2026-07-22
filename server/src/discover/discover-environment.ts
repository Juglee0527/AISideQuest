export interface DiscoverEnvironment {
  GITHUB_DISCOVER_TOKEN: string
  GITHUB_DISCOVER_ORGANIZATIONS: string[]
  GITHUB_DISCOVER_REPOSITORIES: string[]
}

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/
const MAX_GITHUB_SCOPES = 20

export function readDiscoverEnvironment(
  configuration: Record<string, unknown>,
): DiscoverEnvironment {
  const token = readOptionalString(configuration.GITHUB_DISCOVER_TOKEN)
  const organizations = parseOrganizations(configuration.GITHUB_DISCOVER_ORGANIZATIONS)
  const repositories = parseRepositories(configuration.GITHUB_DISCOVER_REPOSITORIES)
  const scopeCount = organizations.length + repositories.length

  if (token !== '' && !/^[\x21-\x7E]{20,200}$/.test(token)) {
    throw new Error('GITHUB_DISCOVER_TOKEN must be a server-only token from 20 to 200 visible ASCII characters')
  }

  if ((token === '') !== (scopeCount === 0)) {
    throw new Error(
      'GITHUB_DISCOVER_TOKEN and at least one GitHub Discover organization or repository must be configured together',
    )
  }
  if (scopeCount > MAX_GITHUB_SCOPES) {
    throw new Error(`GitHub Discover allows at most ${MAX_GITHUB_SCOPES} approved scopes`)
  }

  return {
    GITHUB_DISCOVER_TOKEN: token,
    GITHUB_DISCOVER_ORGANIZATIONS: organizations,
    GITHUB_DISCOVER_REPOSITORIES: repositories,
  }
}

function parseOrganizations(value: unknown) {
  return parseCommaSeparated(value, 'GITHUB_DISCOVER_ORGANIZATIONS')
    .map((organization) => {
      if (!GITHUB_OWNER_PATTERN.test(organization)) {
        throw new Error('GITHUB_DISCOVER_ORGANIZATIONS contains an invalid GitHub organization')
      }
      return organization.toLowerCase()
    })
}

function parseRepositories(value: unknown) {
  return parseCommaSeparated(value, 'GITHUB_DISCOVER_REPOSITORIES')
    .map((repository) => {
      const segments = repository.split('/')
      if (
        segments.length !== 2
        || !GITHUB_OWNER_PATTERN.test(segments[0] ?? '')
        || !GITHUB_REPOSITORY_PATTERN.test(segments[1] ?? '')
      ) {
        throw new Error('GITHUB_DISCOVER_REPOSITORIES must contain owner/repository values')
      }
      return repository.toLowerCase()
    })
}

function parseCommaSeparated(value: unknown, name: string) {
  const raw = readOptionalString(value)
  if (raw === '') return []

  const parsed = raw.split(',').map((entry) => entry.trim())
  if (parsed.some((entry) => entry === '')) {
    throw new Error(`${name} contains an empty value`)
  }
  if (new Set(parsed.map((entry) => entry.toLowerCase())).size !== parsed.length) {
    throw new Error(`${name} contains a duplicate value`)
  }
  return parsed
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
