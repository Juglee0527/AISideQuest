import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'

import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import { DiscoverListQueryDto } from './discover.dto'
import { DiscoverService } from './discover.service'

@Controller('discover')
@UseGuards(SessionAuthGuard)
export class DiscoverController {
  constructor(private readonly discoverService: DiscoverService) {}

  @Get()
  listDiscover(
    @Req() request: AuthenticatedRequest,
    @Query() query: DiscoverListQueryDto,
  ) {
    return this.discoverService.listDiscover(request.auth.user.id, query)
  }

  @Get('sources')
  listSources() {
    return this.discoverService.listSources()
  }
}
