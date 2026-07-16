import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { hashIdentifier } from './event-recorder.mjs'
import { sendIntegrationEvent } from './event-sender.mjs'

export async function sendTestEvent({
  environment = process.env,
  fetchImpl = fetch,
} = {}) {
  const eventId = randomUUID()
  const sessionKey = hashIdentifier(`device-test:${eventId}`)

  if (sessionKey === null) {
    throw new Error('테스트 이벤트 식별자를 생성하지 못했습니다.')
  }

  const data = await sendIntegrationEvent(
    {
      schemaVersion: 1,
      eventId,
      provider: 'CODEX',
      event: 'SessionStart',
      sessionKey,
      observedAt: new Date().toISOString(),
    },
    { environment, fetchImpl },
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
