import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common'

import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import { QuestListQueryDto } from './quest.dto'
import { QuestService } from './quest.service'

@Controller('quests')
@UseGuards(SessionAuthGuard)
export class QuestController {
  constructor(private readonly questService: QuestService) {}

  @Get()
  listQuests(
    @Req() request: AuthenticatedRequest,
    @Query() query: QuestListQueryDto,
  ) {
    return this.questService.listQuests(request.auth.user.id, query)
  }

  @Get(':code')
  getQuest(
    @Req() request: AuthenticatedRequest,
    @Param('code') code: string,
  ) {
    return this.questService.getQuest(request.auth.user.id, code)
  }
}
