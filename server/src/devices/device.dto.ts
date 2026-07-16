import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'

export class CreateDeviceLinkDto {
  @IsUUID('4')
  code!: string
}

export class RedeemDeviceLinkDto {
  @IsUUID('4')
  code!: string

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  deviceToken!: string

  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(100)
  deviceName!: string

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,49}$/)
  pluginVersion!: string
}
