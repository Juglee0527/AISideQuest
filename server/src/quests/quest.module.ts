import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { QuestController } from './quest.controller'
import { QuestService } from './quest.service'

@Module({
  imports: [AuthModule],
  controllers: [QuestController],
  providers: [QuestService],
})
export class QuestModule {}
