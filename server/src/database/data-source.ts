import 'reflect-metadata'

import { DataSource, type DataSourceOptions } from 'typeorm'

import { readDatabaseEnvironment } from './database-environment'
import { InitialSchema1784160000000 } from './migrations/1784160000000-initial-schema'
import { AddAuthentication1784163600000 } from './migrations/1784163600000-add-authentication'
import { AddSessionApiIdempotency1784167200000 } from './migrations/1784167200000-add-session-api-idempotency'

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
    ],
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    logging: false,
  }
}

const AppDataSource = new DataSource(createDataSourceOptions())

export default AppDataSource
