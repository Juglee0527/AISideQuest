import { SetMetadata } from '@nestjs/common'

export const RATE_LIMIT_METADATA = 'aisidequest:rate-limit'

export type RateLimitIdentity =
  | 'IP'
  | 'IP_AND_STATE'
  | 'USER_AND_IP'
  | 'DEVICE_AND_IP'
  | 'IP_AND_LINK_CODE'

export interface RateLimitPolicy {
  scope: string
  limit: number
  windowSeconds: number
  identity: RateLimitIdentity
}

export const RateLimit = (policy: RateLimitPolicy) =>
  SetMetadata(RATE_LIMIT_METADATA, policy)
