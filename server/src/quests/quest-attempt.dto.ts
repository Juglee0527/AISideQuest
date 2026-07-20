import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsUUID,
  ValidateNested,
} from 'class-validator'

export class QuestAnswerDto {
  @IsUUID()
  questionId!: string

  @IsUUID()
  selectedOptionId!: string
}

export class ReplaceQuestAnswersDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuestAnswerDto)
  answers!: QuestAnswerDto[]
}
