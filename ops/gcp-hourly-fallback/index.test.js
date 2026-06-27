'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { getJstParts, isQuietHour, isSameHour } = require('./index')

test('getJstParts returns JST hour key', () => {
  const parts = getJstParts(new Date('2026-06-27T04:12:00Z'))
  assert.equal(parts.hourKey, '2026-06-27T13')
  assert.equal(parts.hour, 13)
  assert.equal(parts.minute, 12)
})

test('quiet hours are JST 1 through 6', () => {
  assert.equal(isQuietHour(0), false)
  assert.equal(isQuietHour(1), true)
  assert.equal(isQuietHour(6), true)
  assert.equal(isQuietHour(7), false)
})

test('isSameHour compares by JST hour', () => {
  assert.equal(isSameHour('2026-06-27T04:00:01Z', '2026-06-27T13'), true)
  assert.equal(isSameHour('2026-06-27T03:59:59Z', '2026-06-27T13'), false)
})
