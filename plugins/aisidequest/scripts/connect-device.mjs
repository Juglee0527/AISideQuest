import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { pathToFileURL } from 'node:url'

import { normalizeApiUrl, postApi } from './api-client.mjs'
import { writeDeviceConfig } from './device-config.mjs'

const DEFAULT_API_URL = 'http://localhost:3000/api/v1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function parseArguments(args) {
  const values = new Map()

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]

    if (!name?.startsWith('--') || value === undefined) {
      throw new Error('사용법: connect-device.mjs --code <UUID> [--api-url <URL>] [--name <기기명>]')
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
  const normalizedDeviceName = deviceName.trim()

  if (normalizedDeviceName === '' || normalizedDeviceName.length > 100) {
    throw new Error('기기명은 1자 이상 100자 이하여야 합니다.')
  }

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

  if (
    typeof data !== 'object' ||
    data === null ||
    typeof data.device !== 'object' ||
    data.device === null ||
    typeof data.device.id !== 'string'
  ) {
    throw new Error('기기 연결 응답 형식이 올바르지 않습니다.')
  }

  const configPath = await writeDeviceConfig(
    {
      schemaVersion: 1,
      apiUrl: normalizedApiUrl,
      deviceToken,
      pluginVersion,
      connectedAt: new Date().toISOString(),
      device: {
        id: data.device.id,
        name: data.device.name,
      },
    },
    environment,
  )

  return { device: data.device, configPath }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const result = await connectDevice({
    code: args.get('--code') ?? '',
    apiUrl: args.get('--api-url') ?? DEFAULT_API_URL,
    deviceName: args.get('--name') ?? hostname(),
  })

  process.stdout.write(`AISideQuest 기기 연결 완료: ${result.device.name}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
