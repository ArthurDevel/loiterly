'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  canTriggerCompanionPing,
  isCompanionSuppressed,
  normalizeCompanionInputEvent,
  shouldAutoReleaseTypingSuppression,
  shouldReleaseTypingSuppression,
  shouldTriggerUnreadPing,
} = require('../electron/companion/state.cjs')

test('typing suppresses the companion even when the main window is hidden', () => {
  assert.equal(
    isCompanionSuppressed({
      isCompanionEnabled: true,
      isCompanionSuppressedForTyping: true,
      isMainWindowVisible: false,
    }),
    true
  )

  assert.equal(
    canTriggerCompanionPing({
      isCompanionEnabled: true,
      isCompanionSuppressedForTyping: true,
      isMainWindowVisible: false,
    }),
    false
  )
})

test('closing the main window can trigger a ping when typing suppression is not active', () => {
  assert.equal(
    canTriggerCompanionPing({
      isCompanionEnabled: true,
      isCompanionSuppressedForTyping: false,
      isMainWindowVisible: false,
    }),
    true
  )
})

test('unread pings only fire on increases after the initial snapshot', () => {
  assert.equal(shouldTriggerUnreadPing(null, 3), false)
  assert.equal(shouldTriggerUnreadPing(0, 0), false)
  assert.equal(shouldTriggerUnreadPing(3, 2), false)
  assert.equal(shouldTriggerUnreadPing(2, 5), true)
})

test('typing suppression only clears on pointer activity', () => {
  assert.equal(shouldReleaseTypingSuppression('pointer'), true)
  assert.equal(shouldReleaseTypingSuppression('cursor-move'), false)
  assert.equal(shouldReleaseTypingSuppression('keyboard'), false)
})

test('typing suppression auto-releases after keyboard inactivity', () => {
  assert.equal(shouldAutoReleaseTypingSuppression(300, 900), false)
  assert.equal(shouldAutoReleaseTypingSuppression(900, 900), true)
  assert.equal(shouldAutoReleaseTypingSuppression(1400, 900), true)
})

test('global input monitor events are normalized conservatively', () => {
  assert.equal(normalizeCompanionInputEvent('keyboard'), 'keyboard')
  assert.equal(normalizeCompanionInputEvent(' pointer '), 'pointer')
  assert.equal(normalizeCompanionInputEvent('unknown'), null)
})
