import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function createRandomToken() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function createPkceChallenge(codeVerifier: string) {
  return createHash('sha256').update(codeVerifier, 'utf8').digest('base64url')
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}
