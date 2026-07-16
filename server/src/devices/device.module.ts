import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ApiIdempotencyModule } from '../common/idempotency/api-idempotency.module'
import { DeviceController } from './device.controller'
import { DeviceService } from './device.service'

@Module({
  imports: [AuthModule, ApiIdempotencyModule],
  controllers: [DeviceController],
  providers: [DeviceService],
})
export class DeviceModule {}
