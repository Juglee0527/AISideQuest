import { Module } from '@nestjs/common'

import { ApiIdempotencyService } from './api-idempotency.service'

@Module({
  providers: [ApiIdempotencyService],
  exports: [ApiIdempotencyService],
})
export class ApiIdempotencyModule {}
