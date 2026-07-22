import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const alertsPath = new URL('../ops/prometheus-alerts.yml', import.meta.url)
const dashboardPath = new URL('../ops/grafana-discover-dashboard.json', import.meta.url)

test('Discover dashboard contains freshness, failure, latency, item, cache, and product panels', async () => {
  const dashboard = JSON.parse(await readFile(dashboardPath, 'utf8'))
  const expressions = dashboard.panels.flatMap((panel) => panel.targets.map((target) => target.expr)).join('\n')
  for (const metric of [
    'aisidequest_discover_source_freshness_seconds',
    'aisidequest_discover_source_fetch_total',
    'aisidequest_discover_source_fetch_duration_seconds_bucket',
    'aisidequest_discover_source_item_count',
    'aisidequest_discover_cache_total',
    'aisidequest_discover_product_events_30d',
  ]) assert.match(expressions, new RegExp(metric))
  assert.equal(dashboard.timezone, 'utc')
  assert.equal(dashboard.time.from, 'now-30d')
})

test('Discover warning and critical alerts are code-managed without identifier labels', async () => {
  const alerts = await readFile(alertsPath, 'utf8')
  assert.match(alerts, /AISideQuestDiscoverSourceFailure/)
  assert.match(alerts, /AISideQuestDiscoverSourceUnavailable/)
  assert.match(alerts, /AISideQuestDiscoverSourceLatencyHigh/)
  assert.match(alerts, /severity: warning/)
  assert.match(alerts, /severity: critical/)
  assert.doesNotMatch(alerts, /user_id|userId|item_id|itemId|originalUrl/)
})
