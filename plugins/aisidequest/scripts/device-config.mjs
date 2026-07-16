import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveDataDirectory } from './event-recorder.mjs'

const CONFIG_FILE_NAME = 'device.json'

export class DeviceConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DeviceConfigError'
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveConfigPath(environment = process.env) {
  return join(resolveDataDirectory(environment), CONFIG_FILE_NAME)
}

export async function writeDeviceConfig(config, environment = process.env) {
  const configPath = resolveConfigPath(environment)
  const temporaryPath = `${configPath}.${process.pid}.tmp`

  await mkdir(resolveDataDirectory(environment), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryPath, configPath)

  try {
    await chmod(configPath, 0o600)
  } catch {
    // Windows does not apply POSIX file modes. The user-local data directory is used.
  }

  return configPath
}

export async function readDeviceConfig(environment = process.env) {
  const configPath = resolveConfigPath(environment)
  let parsed

  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'))
  } catch {
    throw new DeviceConfigError(
      'AISideQuest 기기 연결 정보가 없습니다. 먼저 connect-device.mjs를 실행해 주세요.',
    )
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.apiUrl !== 'string' ||
    typeof parsed.deviceToken !== 'string' ||
    typeof parsed.pluginVersion !== 'string' ||
    !isRecord(parsed.device) ||
    typeof parsed.device.id !== 'string'
  ) {
    throw new DeviceConfigError(
      'AISideQuest 기기 연결 정보가 올바르지 않습니다. 다시 연결해 주세요.',
    )
  }

  return parsed
}
