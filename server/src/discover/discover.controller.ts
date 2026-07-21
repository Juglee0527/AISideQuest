import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'

import { CsrfGuard } from '../auth/csrf.guard'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { AuthenticatedRequest } from '../auth/auth.types'
import { assertEmptyBody, parseIdempotencyKey, parseUuid } from '../sessions/session-input'
import {
  DiscoverListQueryDto,
  DiscoverSavedItemListQueryDto,
  SaveDiscoverItemDto,
  UpdateDiscoverInterestsDto,
} from './discover.dto'
import { DiscoverInterestService } from './discover-interest.service'
import { DiscoverSavedService } from './discover-saved.service'
import { DiscoverService } from './discover.service'

@Controller('discover')
@UseGuards(SessionAuthGuard)
export class DiscoverController {
  constructor(
    private readonly discoverService: DiscoverService,
    private readonly savedService: DiscoverSavedService,
    private readonly interestService: DiscoverInterestService,
  ) {}

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

  @Get('saved-items')
  listSavedItems(
    @Req() request: AuthenticatedRequest,
    @Query() query: DiscoverSavedItemListQueryDto,
  ) {
    return this.savedService.listSavedItems(
      request.auth.user.id,
      query.limit,
      query.cursor,
    )
  }

  @Get('interests')
  getInterests(@Req() request: AuthenticatedRequest) {
    return this.interestService.getInterests(request.auth.user.id)
  }

  @Put('interests')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  updateInterests(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: UpdateDiscoverInterestsDto,
  ) {
    return this.interestService.updateInterests(
      request.auth.user.id,
      body.tags,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Post('saved-items')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  saveItem(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: SaveDiscoverItemDto,
  ) {
    return this.savedService.saveItem(
      request.auth.user.id,
      body.itemId,
      parseIdempotencyKey(idempotencyKey),
    )
  }

  @Delete('saved-items/:savedItemId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  deleteItem(
    @Req() request: AuthenticatedRequest,
    @Param('savedItemId') savedItemId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    assertEmptyBody(body, 'saved item deletion does not accept a request body')
    return this.savedService.deleteItem(
      request.auth.user.id,
      parseUuid(savedItemId, 'savedItemId'),
      parseIdempotencyKey(idempotencyKey),
    )
  }
}
