import 'reflect-metadata'

import { DataSource } from 'typeorm'

import { safeErrorSummary } from '../common/security/sensitive-redaction'
import { createDataSourceOptions } from './data-source'
import { readDatabaseEnvironment } from './database-environment'

const MIGRATION_LOCK_NAME = 'aisidequest:deploy:migrations'

async function run() {
  const environment = readDatabaseEnvironment(process.env)
  if (process.env.NODE_ENV === 'production') {
    const databaseUrl = new URL(environment.DATABASE_URL)
    if (
      !environment.DATABASE_SSL
      || databaseUrl.hostname === '127.0.0.1'
      || databaseUrl.password === 'aisidequest'
    ) {
      throw new Error('PRODUCTION_DATABASE_CONFIGURATION_INVALID')
    }
  }
  const dataSource = new DataSource(createDataSourceOptions())
  await dataSource.initialize()
  const lockRunner = dataSource.createQueryRunner()
  await lockRunner.connect()

  try {
    const [lock] = (await lockRunner.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [MIGRATION_LOCK_NAME],
    )) as Array<{ acquired: boolean }>
    if (!lock?.acquired) {
      throw new Error('MIGRATION_LOCK_UNAVAILABLE')
    }

    const migrations = await dataSource.runMigrations({ transaction: 'all' })
    if (await dataSource.showMigrations()) {
      throw new Error('PENDING_MIGRATIONS_REMAIN')
    }

    process.stdout.write(`${JSON.stringify({
      event: 'migration_complete',
      applied: migrations.map((migration) => migration.name),
    })}\n`)
  } finally {
    await lockRunner.query(
      'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
      [MIGRATION_LOCK_NAME],
    ).catch(() => undefined)
    await lockRunner.release()
    await dataSource.destroy()
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    event: 'migration_failed',
    error: safeErrorSummary(error),
  })}\n`)
  process.exitCode = 1
})
