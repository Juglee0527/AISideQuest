import {
  IsHexadecimal,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator'

export class CreateBrowserDeviceLinkRequestDto {
  @IsUUID('4')
  requestId!: string

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  verifierChallenge!: string

  @IsString()
  @IsHexadecimal()
  @Matches(/^[0-9a-f]{64}$/)
  deviceTokenHash!: string

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

export class CompleteBrowserDeviceLinkRequestDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  verifier!: string
}

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
