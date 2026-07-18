const DEFAULT_TIMEOUT_MS = 5_000

export async function sendTestAlert({
  webhookUrl,
  environment = 'staging',
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const url = new URL(webhookUrl)
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Alert test webhook must use HTTPS outside localhost')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'AISideQuestAlertPipelineTest',
        severity: 'info',
        environment,
        sentAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`)
    return { delivered: true, status: response.status }
  } finally {
    clearTimeout(timeout)
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  sendTestAlert({
    webhookUrl: process.env.ALERT_TEST_WEBHOOK_URL,
    environment: process.env.DEPLOYMENT_ENVIRONMENT ?? 'staging',
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      delivered: false,
      error: error instanceof Error ? error.message : 'Alert delivery failed',
    })}\n`)
    process.exitCode = 1
  })
}
