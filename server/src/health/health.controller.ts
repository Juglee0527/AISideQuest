import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'

import { DatabaseService } from '../database/database.service'
import { MetricsAuthGuard } from '../observability/metrics-auth.guard'
import { OperationalMetricsService } from '../observability/operational-metrics.service'

interface HealthResponse {
  status: 'ok'
  service: 'aisidequest-api'
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly metricsService: OperationalMetricsService,
  ) {}

  @Get()
  getHealth(): HealthResponse {
    return this.getLiveness()
  }

  @Get('live')
  getLiveness(): HealthResponse {
    return { status: 'ok', service: 'aisidequest-api' }
  }

  @Get('ready')
  async getReadiness(): Promise<HealthResponse> {
    if (!(await this.databaseService.checkReadiness())) {
      throw new ServiceUnavailableException({ code: 'NOT_READY' })
    }
    return { status: 'ok', service: 'aisidequest-api' }
  }

  @Get('metrics')
  @UseGuards(MetricsAuthGuard)
  async getMetrics(@Res() response: Response) {
    response.type('text/plain; version=0.0.4')
    response.send(await this.metricsService.renderPrometheus())
  }
}
