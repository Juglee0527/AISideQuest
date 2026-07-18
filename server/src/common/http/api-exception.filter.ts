import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common'
import type { Response } from 'express'
import { safeErrorSummary } from '../security/sensitive-redaction'

interface ApiError {
  code: string
  message: string
  details?: string[]
}

interface ApiErrorResponse {
  error: ApiError
  meta: {
    serverTime: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getHttpExceptionPayload(exception: HttpException) {
  const payload = exception.getResponse()

  return isRecord(payload) ? payload : { message: payload }
}

function getValidationDetails(payload: Record<string, unknown>) {
  return Array.isArray(payload.message)
    ? payload.message.filter((message): message is string => typeof message === 'string')
    : []
}

function getErrorCode(status: number, payload: Record<string, unknown>) {
  if (typeof payload.code === 'string' && payload.code.trim() !== '') {
    return payload.code
  }

  if (status === HttpStatus.BAD_REQUEST && getValidationDetails(payload).length > 0) {
    return 'VALIDATION_ERROR'
  }

  switch (status) {
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'PAYLOAD_TOO_LARGE'
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST'
    case HttpStatus.UNAUTHORIZED:
      return 'AUTH_REQUIRED'
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN'
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND'
    case HttpStatus.CONFLICT:
      return 'CONFLICT'
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE_ENTITY'
    default:
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR'
  }
}

function getErrorMessage(status: number, payload: Record<string, unknown>) {
  if (status === HttpStatus.BAD_REQUEST && getValidationDetails(payload).length > 0) {
    return '요청값이 올바르지 않습니다.'
  }

  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return '로그인이 필요합니다.'
    case HttpStatus.FORBIDDEN:
      return '요청한 작업을 수행할 권한이 없습니다.'
    case HttpStatus.NOT_FOUND:
      return '요청한 리소스를 찾을 수 없습니다.'
    case HttpStatus.CONFLICT:
      return '현재 상태에서는 요청을 처리할 수 없습니다.'
    default:
      if (status >= 500) {
        return '서버 내부 오류가 발생했습니다.'
      }

      return typeof payload.message === 'string'
        ? payload.message
        : '요청을 처리할 수 없습니다.'
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    const isHttpException = exception instanceof HttpException
    const status = isHttpException
      ? exception.getStatus()
      : this.getStatus(exception)
    const payload = isHttpException
      ? getHttpExceptionPayload(exception)
      : {}
    const validationDetails = getValidationDetails(payload)

    if (!isHttpException && status >= 500) {
      this.logger.error(`Unhandled API exception: ${safeErrorSummary(exception)}`)
    }

    const body: ApiErrorResponse = {
      error: {
        code: getErrorCode(status, payload),
        message: getErrorMessage(status, payload),
        ...(validationDetails.length === 0
          ? {}
          : { details: validationDetails }),
      },
      meta: {
        serverTime: new Date().toISOString(),
      },
    }

    response.status(status).json(body)
  }

  private getStatus(exception: unknown) {
    if (
      isRecord(exception)
      && typeof exception.status === 'number'
      && exception.status >= 400
      && exception.status < 600
    ) {
      return exception.status
    }

    return HttpStatus.INTERNAL_SERVER_ERROR
  }
}
