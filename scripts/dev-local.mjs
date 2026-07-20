import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const API_HEALTH_URL = 'http://127.0.0.1:3000/api/v1/health/ready'
const WEB_URL = 'http://localhost:5173/'
const STARTUP_TIMEOUT_MS = 60_000

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

export function npmInvocation(
  platform = process.platform,
  environment = process.env,
) {
  return platform === 'win32'
    ? {
        command: environment.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', 'npm.cmd'],
      }
    : { command: 'npm', args: [] }
}

export function localServiceSpecs(nodeExecutable = process.execPath) {
  return [
    {
      label: 'API',
      command: nodeExecutable,
      args: ['--enable-source-maps', 'server/dist/main.js'],
    },
    {
      label: 'WEB',
      command: nodeExecutable,
      args: ['node_modules/vite/bin/vite.js', '--strictPort'],
    },
  ]
}

export async function assertLocalEnvironment({
  cwd = process.cwd(),
  accessImpl = access,
} = {}) {
  try {
    await accessImpl(resolve(cwd, '.env'))
  } catch {
    throw new Error(
      '.env 파일이 없습니다. .env.example을 .env로 복사하고 GitHub OAuth 값을 입력한 뒤 다시 실행하세요.',
    )
  }
}

export function runCommand(command, args, {
  cwd = process.cwd(),
  environment = process.env,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveCommand()
        return
      }

      reject(new Error(
        `${command} ${args.join(' ')} 실행 실패 (${signal ?? `exit ${code ?? 'unknown'}`})`,
      ))
    })
  })
}

export async function prepareLocalEnvironment({
  cwd = process.cwd(),
  environment = process.env,
  platform = process.platform,
  accessImpl = access,
  assertPortsImpl = assertLocalServicePortsAvailable,
  runCommandImpl = runCommand,
} = {}) {
  await assertLocalEnvironment({ cwd, accessImpl })
  await assertPortsImpl()
  const npm = npmInvocation(platform, environment)

  process.stdout.write('[1/3] PostgreSQL을 시작합니다.\n')
  await runCommandImpl(
    npm.command,
    [...npm.args, 'run', 'db:up'],
    { cwd, environment },
  )
  process.stdout.write('[2/3] migration과 개발 퀘스트를 준비합니다.\n')
  await runCommandImpl(
    npm.command,
    [...npm.args, 'run', 'db:setup'],
    { cwd, environment },
  )
}

export async function waitForEndpoint(url, {
  fetchImpl = fetch,
  delayImpl = delay,
  timeoutMs = STARTUP_TIMEOUT_MS,
  pollIntervalMs = 250,
} = {}) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: url === WEB_URL ? 'text/html' : 'application/json' },
        signal: AbortSignal.timeout(2_000),
      })
      if (response.ok) return
    } catch {
      // The service may still be starting. Retry until the shared deadline.
    }

    await delayImpl(pollIntervalMs)
  }

  throw new Error(`${url} 준비 확인 시간이 초과되었습니다.`)
}

export function assertPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolvePort, reject) => {
    const socket = createConnection({ port, host })
    socket.unref()
    socket.setTimeout(500)
    socket.once('connect', () => {
      socket.destroy()
      reject(new Error(
        `로컬 포트 ${port}이 이미 사용 중입니다. 기존 AISideQuest 실행 창을 사용하거나 종료한 뒤 다시 실행하세요.`,
      ))
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolvePort()
    })
    socket.once('error', (error) => {
      if (
        error &&
        typeof error === 'object' &&
        ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code)
      ) {
        resolvePort()
        return
      }

      if (error && typeof error === 'object' && error.code === 'ECONNRESET') {
        reject(new Error(
          `로컬 포트 ${port}이 이미 사용 중입니다. 기존 AISideQuest 실행 창을 사용하거나 종료한 뒤 다시 실행하세요.`,
        ))
        return
      }

      if (error && typeof error === 'object' && error.code === 'EADDRINUSE') {
        reject(new Error(
          `로컬 포트 ${port}이 이미 사용 중입니다. 기존 AISideQuest 실행 창을 사용하거나 종료한 뒤 다시 실행하세요.`,
        ))
        return
      }
      reject(error)
    })
  })
}

export function assertLocalServicePortsAvailable() {
  return Promise.all([
    assertPortAvailable(3000, '127.0.0.1'),
    assertPortAvailable(3000, '::1'),
    assertPortAvailable(5173, '127.0.0.1'),
    assertPortAvailable(5173, '::1'),
  ])
}

function stopChildren(children) {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
    }
  }
}

export async function runLocalServices({
  cwd = process.cwd(),
  environment = process.env,
  spawnImpl = spawn,
  fetchImpl = fetch,
} = {}) {
  await assertLocalServicePortsAvailable()

  const children = localServiceSpecs().map((service) => ({
    ...service,
    child: spawnImpl(service.command, service.args, {
      cwd,
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    }),
  }))
  let stopping = false
  const exitedChildren = new Set()

  const completion = new Promise((resolveCompletion, reject) => {
    for (const service of children) {
      service.child.once('error', (error) => {
        if (stopping) return
        stopping = true
        stopChildren(children.map((entry) => entry.child))
        reject(error)
      })
      service.child.once('exit', (code, signal) => {
        exitedChildren.add(service.child)
        if (stopping) {
          if (exitedChildren.size === children.length) resolveCompletion()
          return
        }
        stopping = true
        stopChildren(children.map((entry) => entry.child))
        const reason = signal ?? `exit ${code ?? 'unknown'}`
        reject(new Error(`${service.label} 프로세스가 종료되었습니다. (${reason})`))
      })
    }
  })

  const stop = () => {
    if (stopping) return
    stopping = true
    stopChildren(children.map((entry) => entry.child))
  }

  try {
    process.stdout.write('[3/3] API와 웹을 함께 시작합니다.\n')
    await Promise.race([
      Promise.all([
        waitForEndpoint(API_HEALTH_URL, { fetchImpl }),
        waitForEndpoint(WEB_URL, { fetchImpl }),
      ]),
      completion,
    ])
    await Promise.race([delay(750), completion])
  } catch (error) {
    stop()
    throw error
  }

  process.stdout.write('\nAISideQuest 로컬 환경이 준비되었습니다.\n')
  process.stdout.write(`- 웹: ${WEB_URL}\n`)
  process.stdout.write('- Codex 연결: "AISideQuest 연결해줘"\n')
  process.stdout.write('- 종료: Ctrl+C\n\n')

  return { completion, stop }
}

export async function startLocalDevelopment(options = {}) {
  await prepareLocalEnvironment(options)
  const services = await runLocalServices(options)

  const stop = () => services.stop()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  await services.completion
}

async function main() {
  try {
    await startLocalDevelopment()
  } catch (error) {
    process.stderr.write(`\n로컬 실행 실패: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
}
