import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import pg from 'pg'

const { Client } = pg
const DAY_MS = 86_400_000

export function validateDiscoverPilotWindow(startValue, endValue, reportTimeZone) {
  const start = new Date(startValue)
  const end = new Date(endValue)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error('pilot boundaries must be valid ISO timestamps')
  }
  if (!String(startValue).endsWith('T00:00:00.000Z') || !String(endValue).endsWith('T00:00:00.000Z')) {
    throw new Error('pilot boundaries must be UTC midnight with millisecond precision')
  }
  if (end.getTime() - start.getTime() !== 7 * DAY_MS) {
    throw new Error('pilot window must contain exactly seven consecutive UTC dates')
  }
  if (typeof reportTimeZone !== 'string' || reportTimeZone.trim() === '') {
    throw new Error('report timezone must be a valid IANA timezone')
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: reportTimeZone }).format(start)
  } catch {
    throw new Error('report timezone must be a valid IANA timezone')
  }
  return { start: start.toISOString(), end: end.toISOString(), reportTimeZone }
}

function numeric(value) {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeDiscoverPilotRow(row) {
  return {
    aiSessionUsers: numeric(row.ai_session_users),
    discoverUsers: numeric(row.discover_users),
    outboundUsers: numeric(row.outbound_users),
    saveUsers: numeric(row.save_users),
    repeatUsers: numeric(row.repeat_users),
    eventCount: numeric(row.event_count),
    discoverViewEvents: numeric(row.discover_view_events),
    tabViewEvents: numeric(row.tab_view_events),
    outboundEvents: numeric(row.outbound_events),
    saveEvents: numeric(row.save_events),
    discoverEntryRate: numeric(row.discover_entry_rate),
    outboundRate: numeric(row.outbound_rate),
    saveRate: numeric(row.save_rate),
    repeatVisitRate: numeric(row.repeat_visit_rate),
    eventBreakdown: Array.isArray(row.event_breakdown) ? row.event_breakdown : [],
    hourlyEventBreakdown: Array.isArray(row.hourly_event_breakdown) ? row.hourly_event_breakdown : [],
  }
}

export async function collectDiscoverPilot({ databaseUrl, databaseSsl, start, end, reportTimeZone }) {
  const window = validateDiscoverPilotWindow(start, end, reportTimeZone)
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const sql = await readFile(new URL('../ops/discover-pilot-metrics.sql', import.meta.url), 'utf8')
  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseSsl ? { rejectUnauthorized: true } : false,
  })
  try {
    await client.connect()
    const result = await client.query(sql, [window.start, window.end])
    if (result.rows.length !== 1) throw new Error('pilot query must return exactly one aggregate row')
    return {
      schemaVersion: 1,
      observationStartedAt: window.start,
      observationEndedAt: window.end,
      reportTimeZone: window.reportTimeZone,
      collectedAt: new Date().toISOString(),
      metrics: normalizeDiscoverPilotRow(result.rows[0]),
    }
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function main() {
  const [start, end, reportTimeZone] = process.argv.slice(2)
  if (!start || !end || !reportTimeZone) {
    throw new Error('usage: npm run discover:pilot:collect -- <start-utc> <end-utc> <report-timezone>')
  }
  const result = await collectDiscoverPilot({
    databaseUrl: process.env.DATABASE_URL,
    databaseSsl: process.env.DATABASE_SSL === 'true',
    start,
    end,
    reportTimeZone,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
