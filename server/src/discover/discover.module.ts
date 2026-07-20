import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { DiscoverController } from './discover.controller'
import { DiscoverService } from './discover.service'

@Module({
  imports: [AuthModule],
  controllers: [DiscoverController],
  providers: [DiscoverService],
})
export class DiscoverModule {}
