import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveDataDirectory } from './event-recorder.mjs'

const CONFIG_FILE_NAME = 'device.json'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function resolveConfigPath(environment = process.env) {
  return join(resolveDataDirectory(environment), CONFIG_FILE_NAME)
}

function resolveConnectionConfigPath(environment = process.env) {
  return resolveConfigPath({ ...environment, PLUGIN_DATA: '' })
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
  const configPaths = [resolveConfigPath(environment)]
  const connectionConfigPath = resolveConnectionConfigPath(environment)

  if (!configPaths.includes(connectionConfigPath)) {
    configPaths.push(connectionConfigPath)
  }

  let parsed

  for (const configPath of configPaths) {
    try {
      parsed = JSON.parse(await readFile(configPath, 'utf8'))
      break
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue
      }

      throw new Error('AISideQuest 기기 연결 정보가 올바르지 않습니다. 다시 연결해 주세요.')
    }
  }

  if (parsed === undefined) {
    throw new Error('AISideQuest 기기 연결 정보가 없습니다. 먼저 connect-device.mjs를 실행해 주세요.')
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.apiUrl !== 'string' ||
    typeof parsed.deviceToken !== 'string' ||
    typeof parsed.pluginVersion !== 'string' ||
    !isRecord(parsed.device) ||
    typeof parsed.device.id !== 'string'
  ) {
    throw new Error('AISideQuest 기기 연결 정보가 올바르지 않습니다. 다시 연결해 주세요.')
  }

  return parsed
}
