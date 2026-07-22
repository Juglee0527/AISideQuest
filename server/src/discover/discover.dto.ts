import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

import {
  DISCOVER_CATEGORIES,
  DISCOVER_CLIENT_ANALYTICS_EVENTS,
  DISCOVER_ITEM_ID_PATTERN,
  DISCOVER_INTEREST_TAGS,
  DISCOVER_SOURCES,
  type DiscoverCategory,
  type DiscoverClientAnalyticsEvent,
  type DiscoverSource,
  type DiscoverInterestTag,
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

export class SaveDiscoverItemDto {
  @IsString()
  @Matches(DISCOVER_ITEM_ID_PATTERN)
  itemId!: string
}

export class DiscoverSavedItemListQueryDto {
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

export class UpdateDiscoverInterestsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsEnum(DISCOVER_INTEREST_TAGS, { each: true })
  tags!: DiscoverInterestTag[]
}

export class RecordDiscoverAnalyticsEventDto {
  @IsEnum(DISCOVER_CLIENT_ANALYTICS_EVENTS)
  eventName!: DiscoverClientAnalyticsEvent

  @IsOptional()
  @IsEnum(DISCOVER_SOURCES)
  source?: DiscoverSource

  @IsOptional()
  @IsEnum(DISCOVER_CATEGORIES)
  category?: DiscoverCategory
}
