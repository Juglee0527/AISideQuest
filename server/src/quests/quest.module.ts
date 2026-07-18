import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ApiIdempotencyModule } from '../common/idempotency/api-idempotency.module'
import { QuestAttemptController } from './quest-attempt.controller'
import { QuestAttemptRecoveryService } from './quest-attempt-recovery.service'
import { QuestAttemptService } from './quest-attempt.service'
import { QuestController } from './quest.controller'
import { QuestService } from './quest.service'

@Module({
  imports: [AuthModule, ApiIdempotencyModule],
  controllers: [QuestController, QuestAttemptController],
  providers: [QuestService, QuestAttemptService, QuestAttemptRecoveryService],
  exports: [QuestAttemptRecoveryService],
})
export class QuestModule {}
