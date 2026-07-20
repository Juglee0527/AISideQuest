import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'

import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import {
  StatisticsActivityQueryDto,
  StatisticsSummaryQueryDto,
} from './statistics.dto'
import { StatisticsService } from './statistics.service'

@Controller('stats')
@UseGuards(SessionAuthGuard)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('summary')
  async getSummary(
    @Req() request: AuthenticatedRequest,
    @Query() query: StatisticsSummaryQueryDto,
  ) {
    const summary = await this.statisticsService.getSummary(request.auth.user.id, query)
    request.responseServerTime = summary.asOf
    return summary
  }

  @Get('activity')
  async listActivity(
    @Req() request: AuthenticatedRequest,
    @Query() query: StatisticsActivityQueryDto,
  ) {
    const activity = await this.statisticsService.listActivity(request.auth.user.id, query)
    request.responseServerTime = activity.asOf
    return activity
  }
}
