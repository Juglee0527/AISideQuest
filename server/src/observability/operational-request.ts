import type { Request } from 'express'

export interface OperationalRequest extends Request {
  requestId: string
  responseServerTime?: string
}

export function isValidRequestId(value: string | undefined): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(value)
}

export function routeTemplate(request: Request) {
  const route = request.route as { path?: unknown } | undefined
  return typeof route?.path === 'string'
    ? route.path
    : 'UNMATCHED'
}
