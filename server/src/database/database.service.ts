import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DataSource, type EntityManager } from 'typeorm'

import type { AppEnvironment } from '../config/environment'
import { createDataSourceOptions } from './data-source'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private dataSource?: DataSource

  constructor(
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  async onModuleInit() {
    this.dataSource = new DataSource(
      createDataSourceOptions({
        DATABASE_URL: this.configService.getOrThrow('DATABASE_URL'),
        DATABASE_SSL: this.configService.getOrThrow('DATABASE_SSL'),
      }),
    )

    await this.dataSource.initialize()
  }

  async onModuleDestroy() {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy()
    }
  }

  query<T>(query: string, parameters: readonly unknown[] = []): Promise<T> {
    return this.getDataSource().query(query, [...parameters]) as Promise<T>
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.getDataSource().transaction(work)
  }

  private getDataSource() {
    if (!this.dataSource?.isInitialized) {
      throw new Error('Database is not initialized')
    }

    return this.dataSource
  }
}
