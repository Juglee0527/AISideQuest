import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ApiIdempotencyModule } from '../common/idempotency/api-idempotency.module'
import { DeviceAuthGuard } from './device-auth.guard'
import { DeviceAuthService } from './device-auth.service'
import { IntegrationEventController } from './integration-event.controller'
import { SessionController } from './session.controller'
import { SessionRecoveryService } from './session-recovery.service'
import { SessionService } from './session.service'

@Module({
  imports: [AuthModule, ApiIdempotencyModule],
  controllers: [SessionController, IntegrationEventController],
  providers: [
    SessionService,
    SessionRecoveryService,
    DeviceAuthService,
    DeviceAuthGuard,
  ],
  exports: [SessionService, SessionRecoveryService, DeviceAuthGuard],
})
export class SessionModule {}
