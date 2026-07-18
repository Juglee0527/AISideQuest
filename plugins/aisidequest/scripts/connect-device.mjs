import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'

import {
  ApiRequestError,
  normalizeApiUrl,
  postApi,
} from './api-client.mjs'
import { writeDeviceConfig } from './device-config.mjs'

const DEFAULT_API_URL = 'http://localhost:3000/api/v1'
const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1_000
const VERIFICATION_PAGE_TIMEOUT_MS = 5_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseArguments(args) {
  if (args.length % 2 !== 0) {
    throw new Error('사용법: connect-device.mjs [--api-url <URL>] [--name <기기명>] [--code <복구용-연결-코드>]')
  }

  const values = new Map()

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]

    if (!name?.startsWith('--') || value === undefined) {
      throw new Error('사용법: connect-device.mjs [--api-url <URL>] [--name <기기명>] [--code <복구용-연결-코드>]')
    }

    values.set(name, value)
  }

  return values
}

async function readPluginVersion() {
  const manifest = JSON.parse(
    await readFile(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'),
  )

  if (typeof manifest.version !== 'string') {
    throw new Error('플러그인 버전을 확인할 수 없습니다.')
  }

  return manifest.version
}

function normalizeDeviceName(deviceName) {
  const normalizedDeviceName = deviceName.trim()

  if (normalizedDeviceName === '' || normalizedDeviceName.length > 100) {
    throw new Error('기기명은 1자 이상 100자 이하여야 합니다.')
  }

  return normalizedDeviceName
}

function validateConnectedDevice(data) {
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof data.device !== 'object' ||
    data.device === null ||
    typeof data.device.id !== 'string' ||
    typeof data.device.name !== 'string'
  ) {
    throw new Error('기기 연결 응답 형식이 올바르지 않습니다.')
  }

  return data.device
}

async function storeConnectedDevice({
  device,
  deviceToken,
  pluginVersion,
  apiUrl,
  environment,
}) {
  const configPath = await writeDeviceConfig(
    {
      schemaVersion: 1,
      apiUrl,
      deviceToken,
      pluginVersion,
      connectedAt: new Date().toISOString(),
      device: {
        id: device.id,
        name: device.name,
      },
    },
    environment,
  )

  return { device, configPath }
}

export async function connectDevice({
  code,
  apiUrl = DEFAULT_API_URL,
  deviceName = hostname(),
  environment = process.env,
  fetchImpl = fetch,
}) {
  if (!UUID_PATTERN.test(code)) {
    throw new Error('연결 코드는 UUID 형식이어야 합니다.')
  }

  const normalizedApiUrl = normalizeApiUrl(apiUrl)
  const normalizedDeviceName = normalizeDeviceName(deviceName)
  const pluginVersion = await readPluginVersion()
  const deviceToken = randomBytes(32).toString('base64url')
  const data = await postApi(
    '/device-links/redeem',
    {
      code: code.toLowerCase(),
      deviceToken,
      deviceName: normalizedDeviceName,
      pluginVersion,
    },
    { 'Idempotency-Key': randomUUID() },
    normalizedApiUrl,
    fetchImpl,
  )

  return storeConnectedDevice({
    device: validateConnectedDevice(data),
    deviceToken,
    pluginVersion,
    apiUrl: normalizedApiUrl,
    environment,
  })
}

export async function openBrowser(url) {
  const command = process.platform === 'win32'
    ? 'rundll32.exe'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open'
  const args = process.platform === 'win32'
    ? ['url.dll,FileProtocolHandler', url]
    : [url]

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isRetryablePollingError(error) {
  return error instanceof ApiRequestError && (
    error.status === null ||
    error.status === 408 ||
    error.status === 429 ||
    (typeof error.status === 'number' && error.status >= 500)
  )
}

function isLocalUrl(value) {
  const hostname = new URL(value).hostname
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function unavailableMessage(kind, url) {
  const localHint = isLocalUrl(url)
    ? ' 프로젝트 루트에서 npm.cmd run dev:local을 실행한 뒤 다시 연결하세요.'
    : ' 잠시 후 다시 연결하세요.'
  return `AISideQuest ${kind}에 연결할 수 없습니다.${localHint}`
}

export async function assertVerificationPageAvailable(
  verificationUrl,
  fetchImpl = fetch,
) {
  let response

  try {
    response = await fetchImpl(verificationUrl, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(VERIFICATION_PAGE_TIMEOUT_MS),
    })
  } catch {
    throw new Error(unavailableMessage('승인 웹', verificationUrl))
  }

  if (!response.ok) {
    throw new Error(unavailableMessage('승인 웹', verificationUrl))
  }
}

export async function connectDeviceInBrowser({
  apiUrl = DEFAULT_API_URL,
  deviceName = hostname(),
  environment = process.env,
  fetchImpl = fetch,
  verificationFetchImpl = fetch,
  openBrowserImpl = openBrowser,
  waitImpl = wait,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
}) {
  const normalizedApiUrl = normalizeApiUrl(apiUrl)
  const normalizedDeviceName = normalizeDeviceName(deviceName)
  const pluginVersion = await readPluginVersion()
  const requestId = randomUUID()
  const verifier = randomBytes(32).toString('base64url')
  const deviceToken = randomBytes(32).toString('base64url')
  const verifierChallenge = createHash('sha256')
    .update(verifier, 'utf8')
    .digest('base64url')
  const deviceTokenHash = createHash('sha256')
    .update(deviceToken, 'utf8')
    .digest('hex')
  let created

  try {
    created = await postApi(
      '/device-link-requests',
      {
        requestId,
        verifierChallenge,
        deviceTokenHash,
        deviceName: normalizedDeviceName,
        pluginVersion,
      },
      { 'Idempotency-Key': requestId },
      normalizedApiUrl,
      fetchImpl,
    )
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === null) {
      throw new Error(unavailableMessage('API', normalizedApiUrl))
    }
    throw error
  }
  const linkRequest = created?.request

  if (
    typeof linkRequest !== 'object' ||
    linkRequest === null ||
    linkRequest.id !== requestId ||
    typeof linkRequest.verificationUrl !== 'string' ||
    typeof linkRequest.expiresAt !== 'string'
  ) {
    throw new Error('브라우저 연결 요청 응답 형식이 올바르지 않습니다.')
  }

  await assertVerificationPageAvailable(
    linkRequest.verificationUrl,
    verificationFetchImpl,
  )
  await openBrowserImpl(linkRequest.verificationUrl)

  const expiresAt = Date.parse(linkRequest.expiresAt)
  const deadline = Math.min(
    Date.now() + maxWaitMs,
    Number.isFinite(expiresAt) ? expiresAt : Number.POSITIVE_INFINITY,
  )

  while (Date.now() < deadline) {
    try {
      const completed = await postApi(
        `/device-link-requests/${encodeURIComponent(requestId)}/complete`,
        { verifier },
        {},
        normalizedApiUrl,
        fetchImpl,
      )

      if (completed?.request?.status === 'APPROVED') {
        return storeConnectedDevice({
          device: validateConnectedDevice(completed),
          deviceToken,
          pluginVersion,
          apiUrl: normalizedApiUrl,
          environment,
        })
      }

      if (completed?.request?.status !== 'PENDING') {
        throw new Error('브라우저 연결 요청이 더 이상 유효하지 않습니다.')
      }

      const retryAfterMs = Number(completed.retryAfterMs)
      await waitImpl(Number.isFinite(retryAfterMs)
        ? Math.min(5_000, Math.max(250, retryAfterMs))
        : DEFAULT_POLL_INTERVAL_MS)
    } catch (error) {
      if (!isRetryablePollingError(error)) {
        throw error
      }

      await waitImpl(Math.min(5_000, Math.max(
        DEFAULT_POLL_INTERVAL_MS,
        error.retryAfterMs ?? 0,
      )))
    }
  }

  throw new Error('브라우저 연결 승인 시간이 만료되었습니다. 다시 연결해 주세요.')
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const options = {
    apiUrl: args.get('--api-url')
      ?? process.env.AISIDEQUEST_API_URL
      ?? DEFAULT_API_URL,
    deviceName: args.get('--name') ?? hostname(),
  }
  const result = args.has('--code')
    ? await connectDevice({ ...options, code: args.get('--code') ?? '' })
    : await connectDeviceInBrowser(options)

  process.stdout.write(`AISideQuest 기기 연결 완료: ${result.device.name}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
