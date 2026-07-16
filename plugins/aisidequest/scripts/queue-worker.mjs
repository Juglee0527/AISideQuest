import { pathToFileURL } from 'node:url'

import { runDeliveryWorker } from './delivery-worker.mjs'
import { resolveDataDirectory } from './event-recorder.mjs'

export async function main(environment = process.env) {
  await runDeliveryWorker(resolveDataDirectory(environment), { environment })
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    // Delivery failures remain in the durable queue and must not affect Codex.
  })
}
