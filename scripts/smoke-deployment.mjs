import { pathToFileURL } from 'node:url'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(url, options = {}) {
  const response = await fetch(url, { redirect: 'manual', ...options })
  return response
}

export async function smokeDeployment(origin, { allowHttp = false } = {}) {
  const publicOrigin = new URL(origin)
  check(publicOrigin.protocol === 'https:' || allowHttp, 'deployment smoke requires HTTPS unless --allow-http is set')

  const frontendHealth = await request(new URL('/healthz', publicOrigin))
  check(frontendHealth.status === 200, 'frontend health check failed')
  check(frontendHealth.headers.get('x-content-type-options') === 'nosniff', 'security headers are missing')
  if (publicOrigin.protocol === 'https:') {
    check(frontendHealth.headers.get('strict-transport-security')?.includes('max-age='), 'HSTS is missing')
  }

  for (const path of ['/api/v1/health/live', '/api/v1/health/ready']) {
    const response = await request(new URL(path, publicOrigin))
    check(response.status === 200, `${path} returned ${response.status}`)
    const body = await response.json()
    check(body?.data?.status === 'ok' && typeof body?.meta?.requestId === 'string', `${path} response envelope is invalid`)
  }

  const preflight = await request(new URL('/api/v1/auth/me', publicOrigin), {
    method: 'OPTIONS',
    headers: { Origin: publicOrigin.origin, 'Access-Control-Request-Method': 'GET' },
  })
  check(preflight.headers.get('access-control-allow-origin') === publicOrigin.origin, 'configured CORS origin was not accepted')
  check(preflight.headers.get('access-control-allow-credentials') === 'true', 'credentialed CORS is not enabled')

  const hostileOrigin = `https://not-${publicOrigin.hostname}`
  const hostilePreflight = await request(new URL('/api/v1/auth/me', publicOrigin), {
    method: 'OPTIONS',
    headers: { Origin: hostileOrigin, 'Access-Control-Request-Method': 'GET' },
  })
  check(hostilePreflight.headers.get('access-control-allow-origin') !== hostileOrigin, 'unexpected CORS origin was accepted')

  const oauth = await request(new URL('/api/v1/auth/github', publicOrigin))
  check(oauth.status === 302, `OAuth start returned ${oauth.status}`)
  const authorization = new URL(oauth.headers.get('location'))
  check(authorization.protocol === 'https:' && authorization.hostname === 'github.com', 'OAuth redirect does not target GitHub HTTPS')
  check(authorization.searchParams.get('redirect_uri') === `${publicOrigin.origin}/api/v1/auth/github/callback`, 'OAuth callback does not exactly match the deployment origin')
  check(Boolean(authorization.searchParams.get('state')), 'OAuth state is missing')
  check(authorization.searchParams.get('code_challenge_method') === 'S256', 'OAuth PKCE S256 is missing')
  const cookies = typeof oauth.headers.getSetCookie === 'function' ? oauth.headers.getSetCookie() : [oauth.headers.get('set-cookie') ?? '']
  const stateCookie = cookies.find((cookie) => cookie.includes('oauth_state')) ?? ''
  check(/HttpOnly/i.test(stateCookie) && /SameSite=Lax/i.test(stateCookie), 'OAuth state cookie protections are incomplete')
  if (publicOrigin.protocol === 'https:') check(/Secure/i.test(stateCookie), 'OAuth state cookie is not Secure')

  const spa = await request(new URL('/dashboard', publicOrigin))
  check(spa.status === 200 && (spa.headers.get('content-type') ?? '').includes('text/html'), 'SPA fallback is unavailable')

  return { origin: publicOrigin.origin, checks: 10, status: 'passed' }
}

async function main() {
  const [origin, ...flags] = process.argv.slice(2)
  if (!origin) throw new Error('usage: node scripts/smoke-deployment.mjs <origin> [--allow-http]')
  const result = await smokeDeployment(origin, { allowHttp: flags.includes('--allow-http') })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`deployment smoke failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

