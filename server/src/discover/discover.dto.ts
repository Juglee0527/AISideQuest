import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

import {
  DISCOVER_CATEGORIES,
  DISCOVER_SOURCES,
  type DiscoverCategory,
  type DiscoverSource,
} from './discover.types'

export class DiscoverListQueryDto {
  @IsOptional()
  @IsEnum(DISCOVER_CATEGORIES)
  category?: DiscoverCategory

  @IsOptional()
  @IsEnum(DISCOVER_SOURCES)
  source?: DiscoverSource

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  cursor?: string
}
