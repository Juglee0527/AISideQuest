import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { postApi } from './api-client.mjs'
import { readDeviceConfig } from './device-config.mjs'
import { hashIdentifier } from './event-recorder.mjs'

export async function sendTestEvent({
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const config = await readDeviceConfig(environment)
  const eventId = randomUUID()
  const sessionKey = hashIdentifier(`device-test:${eventId}`)

  if (sessionKey === null) {
    throw new Error('테스트 이벤트 식별자를 생성하지 못했습니다.')
  }

  const data = await postApi(
    '/integration-events',
    {
      schemaVersion: 1,
      eventId,
      provider: 'CODEX',
      event: 'SessionStart',
      sessionKey,
      observedAt: new Date().toISOString(),
    },
    {
      Authorization: `Bearer ${config.deviceToken}`,
      'Idempotency-Key': eventId,
    },
    config.apiUrl,
    fetchImpl,
  )

  return data
}

async function main() {
  const result = await sendTestEvent()
  process.stdout.write(`AISideQuest 테스트 이벤트 전송 완료: ${result.result}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
