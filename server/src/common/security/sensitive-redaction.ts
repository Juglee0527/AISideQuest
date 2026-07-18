const REDACTED = '[REDACTED]'

export function redactSensitiveText(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, REDACTED)
    .replace(
      /\b([A-Za-z0-9_-]*(?:authorization|cookie|token|secret|password|csrf|code|state)[A-Za-z0-9_-]*)[\s"']*[:=][\s"']*[^\s,;"']+/gi,
      (_match, key: string) => `${key}=${REDACTED}`,
    )
    .replace(
      /\b(?:[A-Za-z]:\\|\/)(?:[^\s:"'<>|]+[\\/])+[^\s:"'<>|]*/g,
      REDACTED,
    )
}

export function safeErrorSummary(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${redactSensitiveText(error.message).slice(0, 500)}`
  }

  return 'Unknown error'
}
