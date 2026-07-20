import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'

export const STATISTICS_PERIODS = ['today', 'week', 'month', 'custom'] as const
export type StatisticsPeriod = (typeof STATISTICS_PERIODS)[number]

export class StatisticsSummaryQueryDto {
  @IsOptional()
  @IsEnum(STATISTICS_PERIODS)
  period: StatisticsPeriod = 'today'

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start?: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  end?: string
}

export class StatisticsActivityQueryDto extends StatisticsSummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  cursor?: string
}
