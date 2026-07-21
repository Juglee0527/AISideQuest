import 'reflect-metadata'

import { DataSource, type DataSourceOptions } from 'typeorm'

import { readDatabaseEnvironment } from './database-environment'
import { InitialSchema1784160000000 } from './migrations/1784160000000-initial-schema'
import { AddAuthentication1784163600000 } from './migrations/1784163600000-add-authentication'
import { AddSessionApiIdempotency1784167200000 } from './migrations/1784167200000-add-session-api-idempotency'
import { AddDeviceLinking1784170800000 } from './migrations/1784170800000-add-device-linking'
import { AddHeartbeatRecovery1784174400000 } from './migrations/1784174400000-add-heartbeat-recovery'
import { AddQuestListing1784178000000 } from './migrations/1784178000000-add-quest-listing'
import { AddQuestAttemptFlow1784181600000 } from './migrations/1784181600000-add-quest-attempt-flow'
import { AddPointLedger1784185200000 } from './migrations/1784185200000-add-point-ledger'
import { AddServerStatistics1784188800000 } from './migrations/1784188800000-add-server-statistics'
import { AddSecurityControls1784192400000 } from './migrations/1784192400000-add-security-controls'
import { AddOperationalDiagnostics1784196000000 } from './migrations/1784196000000-add-operational-diagnostics'
import { AddBrowserDeviceLinking1784199600000 } from './migrations/1784199600000-add-browser-device-linking'
import { AllowConcurrentHookSessions1784260800000 } from './migrations/1784260800000-allow-concurrent-hook-sessions'
import { AddSanitizedSessionContext1784264400000 } from './migrations/1784264400000-add-sanitized-session-context'
import { AddDiscoverSourceCache1784268000000 } from './migrations/1784268000000-add-discover-source-cache'
import { AddDiscoverSavedItems1784271600000 } from './migrations/1784271600000-add-discover-saved-items'
import { AddDiscoverInterests1784275200000 } from './migrations/1784275200000-add-discover-interests'

export function createDataSourceOptions(
  configuration: Record<string, unknown> = process.env,
): DataSourceOptions {
  const environment = readDatabaseEnvironment(configuration)

  return {
    type: 'postgres',
    url: environment.DATABASE_URL,
    ssl: environment.DATABASE_SSL
      ? { rejectUnauthorized: true }
      : false,
    migrations: [
      InitialSchema1784160000000,
      AddAuthentication1784163600000,
      AddSessionApiIdempotency1784167200000,
      AddDeviceLinking1784170800000,
      AddHeartbeatRecovery1784174400000,
      AddQuestListing1784178000000,
      AddQuestAttemptFlow1784181600000,
      AddPointLedger1784185200000,
      AddServerStatistics1784188800000,
      AddSecurityControls1784192400000,
      AddOperationalDiagnostics1784196000000,
      AddBrowserDeviceLinking1784199600000,
      AllowConcurrentHookSessions1784260800000,
      AddSanitizedSessionContext1784264400000,
      AddDiscoverSourceCache1784268000000,
      AddDiscoverSavedItems1784271600000,
      AddDiscoverInterests1784275200000,
    ],
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    logging: false,
  }
}

const AppDataSource = new DataSource(createDataSourceOptions())

export default AppDataSource
