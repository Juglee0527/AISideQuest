import { Type } from 'class-transformer'
import {
  Equals,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

import { SESSION_STATUSES, type SessionStatus } from './session.types'

export const SESSION_END_OUTCOMES = [
  'COMPLETED',
  'FAILED',
  'ABANDONED',
] as const

export type SessionEndOutcome = (typeof SESSION_END_OUTCOMES)[number]

export class EndSessionDto {
  @IsIn(SESSION_END_OUTCOMES)
  outcome!: SessionEndOutcome
}

export class SessionHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20

  @IsOptional()
  @IsIn(SESSION_STATUSES)
  status?: SessionStatus

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1_000)
  cursor?: string
}

export class IntegrationEventDto {
  @IsInt()
  @Equals(1)
  schemaVersion!: number

  @IsUUID('4')
  eventId!: string

  @Equals('CODEX')
  provider!: 'CODEX'

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  event!: string

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  sessionKey!: string

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  turnKey?: string | null

  @IsISO8601({ strict: true })
  observedAt!: string
}
