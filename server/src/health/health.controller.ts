import { Controller, Get } from '@nestjs/common'

interface HealthResponse {
  status: 'ok'
  service: 'aisidequest-api'
}

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'aisidequest-api',
    }
  }
}
