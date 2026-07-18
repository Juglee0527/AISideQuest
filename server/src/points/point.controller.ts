import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'

import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import { PointLedgerQueryDto } from './point.dto'
import { PointService } from './point.service'

@Controller('points')
@UseGuards(SessionAuthGuard)
export class PointController {
  constructor(private readonly pointService: PointService) {}

  @Get('balance')
  getBalance(@Req() request: AuthenticatedRequest) {
    return this.pointService.getBalance(request.auth.user.id)
  }

  @Get('ledger')
  listLedger(
    @Req() request: AuthenticatedRequest,
    @Query() query: PointLedgerQueryDto,
  ) {
    return this.pointService.listLedger(request.auth.user.id, query)
  }
}
