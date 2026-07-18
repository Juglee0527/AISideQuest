import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { PointController } from './point.controller'
import { PointService } from './point.service'

@Module({
  imports: [AuthModule],
  controllers: [PointController],
  providers: [PointService],
})
export class PointModule {}
