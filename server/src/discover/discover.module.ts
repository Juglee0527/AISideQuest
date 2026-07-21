import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ApiIdempotencyModule } from '../common/idempotency/api-idempotency.module'
import { DISCOVER_SOURCE_ADAPTERS } from './discover-adapter'
import { DiscoverCacheService } from './discover-cache.service'
import { DiscoverController } from './discover.controller'
import { DiscoverHttpClient } from './discover-http-client'
import { DiscoverService } from './discover.service'
import { DevAdapter } from './dev.adapter'
import { HackerNewsAdapter } from './hacker-news.adapter'
import { RemotiveAdapter } from './remotive.adapter'
import { StackExchangeRequestGate } from './stack-exchange-request-gate'
import { StackOverflowAdapter } from './stack-overflow.adapter'
import { DiscoverSavedService } from './discover-saved.service'
import { DiscoverInterestService } from './discover-interest.service'

@Module({
  imports: [AuthModule, ApiIdempotencyModule],
  controllers: [DiscoverController],
  providers: [
    { provide: DiscoverHttpClient, useFactory: () => new DiscoverHttpClient() },
    DiscoverCacheService,
    DevAdapter,
    HackerNewsAdapter,
    RemotiveAdapter,
    { provide: StackExchangeRequestGate, useFactory: () => new StackExchangeRequestGate() },
    StackOverflowAdapter,
    DiscoverService,
    DiscoverSavedService,
    DiscoverInterestService,
    {
      provide: DISCOVER_SOURCE_ADAPTERS,
      inject: [HackerNewsAdapter, RemotiveAdapter, DevAdapter, StackOverflowAdapter],
      useFactory: (
        hackerNewsAdapter: HackerNewsAdapter,
        remotiveAdapter: RemotiveAdapter,
        devAdapter: DevAdapter,
        stackOverflowAdapter: StackOverflowAdapter,
      ) => [hackerNewsAdapter, remotiveAdapter, devAdapter, stackOverflowAdapter],
    },
  ],
})
export class DiscoverModule {}
