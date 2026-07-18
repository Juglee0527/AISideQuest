import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { redactSensitiveText, safeErrorSummary } from '../common/security/sensitive-redaction'
import type { AppEnvironment } from '../config/environment'

type LogLevel = 'info' | 'error'

export interface OperationalEvent {
  event: string
  requestId?: string
  method?: string
  route?: string
  status?: number
  latencyMs?: number
  errorCode?: string
  error?: string
  [key: string]: string | number | boolean | undefined
}

const FORBIDDEN_KEYS = /authorization|cookie|token|secret|password|codeVerifier|requestBody|query|payload/i

export function sanitizeOperationalEvent(event: OperationalEvent) {
  return Object.fromEntries(
    Object.entries(event)
      .filter(([key, value]) => value !== undefined && !FORBIDDEN_KEYS.test(key))
      .map(([key, value]) => [
        key,
        key === 'route' && typeof value === 'string' && /^\/[A-Za-z0-9_:/.-]+$/.test(value)
          ? value
          : typeof value === 'string'
          ? redactSensitiveText(value).slice(0, 500)
          : value,
      ]),
  )
}

@Injectable()
export class OperationalLoggerService {
  constructor(
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  info(event: OperationalEvent) {
    this.write('info', event)
  }

  error(event: OperationalEvent, error?: unknown) {
    this.write('error', {
      ...event,
      ...(error === undefined ? {} : { error: safeErrorSummary(error) }),
    })
  }

  private write(level: LogLevel, event: OperationalEvent) {
    if (!this.configService.getOrThrow('OPERATIONAL_LOG_ENABLED')) {
      return
    }

    const record = sanitizeOperationalEvent({
      timestamp: new Date().toISOString(),
      level,
      environment: this.configService.getOrThrow('DEPLOYMENT_ENVIRONMENT'),
      service: 'aisidequest-api',
      serviceVersion: this.configService.getOrThrow('SERVICE_VERSION'),
      ...event,
    })
    const line = `${JSON.stringify(record)}\n`

    if (level === 'error') {
      process.stderr.write(line)
    } else {
      process.stdout.write(line)
    }
  }
}
