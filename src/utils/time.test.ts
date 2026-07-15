import { describe, expect, it } from 'vitest'

import {
  formatDuration,
  formatSummaryDuration,
  getElapsedMilliseconds,
} from './time'

describe('time utilities', () => {
  it('calculates elapsed milliseconds from an ISO start time', () => {
    expect(
      getElapsedMilliseconds(
        '2026-07-15T00:00:00.000Z',
        Date.parse('2026-07-15T00:01:05.000Z'),
      ),
    ).toBe(65_000)
  })

  it('returns zero for invalid or future start times', () => {
    expect(getElapsedMilliseconds('invalid', 0)).toBe(0)
    expect(
      getElapsedMilliseconds(
        '2026-07-15T00:01:00.000Z',
        Date.parse('2026-07-15T00:00:00.000Z'),
      ),
    ).toBe(0)
  })

  it.each([
    [0, '00:00'],
    [62_000, '01:02'],
    [3_661_000, '01:01:01'],
    [-1, '00:00'],
  ])('formats timer duration %i milliseconds', (duration, expected) => {
    expect(formatDuration(duration)).toBe(expected)
  })

  it.each([
    [0, '0분'],
    [30_000, '1분 미만'],
    [300_000, '5분'],
    [3_900_000, '1시간 5분'],
  ])('formats summary duration %i milliseconds', (duration, expected) => {
    expect(formatSummaryDuration(duration)).toBe(expected)
  })
})
