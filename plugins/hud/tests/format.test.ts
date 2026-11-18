import { expect, test } from 'claude-code/testing'

import { burn, gauge, spark, span, turnCosts, turnsLeft } from '../hooks/format'

const point = (percent: number, usd: number) => ({ percent, usd, seconds: 10, tools: 1 })

test('the first recorded point is not a turn cost', async () => {
  // The session had already cost 30 when the HUD started counting.
  expect(turnCosts([point(10, 30), point(12, 30.5), point(15, 31.5)])).toEqual([0.5, 1])
  expect(turnCosts([point(10, 30)])).toEqual([])
  expect(turnCosts([])).toEqual([])
})

test('turns left follow the mean growth, and say nothing without one', async () => {
  expect(turnsLeft([point(40, 0), point(45, 0), point(50, 0)], 50)).toBe(6)
  expect(turnsLeft([point(40, 0), point(45, 0)], 45)).toBe(null)
  expect(turnsLeft([point(50, 0), point(50, 0), point(50, 0)], 50)).toBe(null)
  expect(turnsLeft([point(70, 0), point(80, 0), point(90, 0)], 90)).toBe(null)
  expect(turnsLeft([point(40, 0), point(45, 0), point(50, 0)], null)).toBe(null)
})

test('figures with nothing to show stay quiet', async () => {
  expect(spark([])).toBe('')
  expect(spark([0, 0])).toBe('▁▁')
  expect(gauge(null, 4)).toBe('▱▱▱▱')
  expect(gauge(250, 4)).toBe('▰▰▰▰')
  expect(burn(5, 0, 30_000)).toBe(null)
  expect(burn(5, 0, 3_600_000)).toBe(5)
  expect(burn(null, 0, 3_600_000)).toBe(null)
  expect(span(64 * 60_000)).toBe('1 h 04')
})
