import { BadRequestException } from '@nestjs/common'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validationError(message: string): never {
  throw new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: [message],
  })
}

export function parseUuid(value: string | undefined, fieldName: string) {
  if (!value || !UUID_PATTERN.test(value)) {
    validationError(`${fieldName} must be a UUID`)
  }

  return value.toLowerCase()
}

export function parseIdempotencyKey(value: string | undefined) {
  return parseUuid(value, 'Idempotency-Key')
}

export function assertEmptyBody(
  body: unknown,
  message = 'manual session start does not accept a request body',
) {
  if (
    body === undefined ||
    (typeof body === 'object' &&
      body !== null &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0)
  ) {
    return
  }

  validationError(message)
}
