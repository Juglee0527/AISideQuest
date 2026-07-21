import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { DISCOVER_SOURCE_ADAPTERS } from './discover-adapter'
import { DiscoverCacheService } from './discover-cache.service'
import { DiscoverController } from './discover.controller'
import { DiscoverHttpClient } from './discover-http-client'
import { DiscoverService } from './discover.service'

@Module({
  imports: [AuthModule],
  controllers: [DiscoverController],
  providers: [
    { provide: DiscoverHttpClient, useFactory: () => new DiscoverHttpClient() },
    DiscoverCacheService,
    DiscoverService,
    { provide: DISCOVER_SOURCE_ADAPTERS, useValue: [] },
  ],
})
export class DiscoverModule {}
