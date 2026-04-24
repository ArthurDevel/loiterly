'use strict'

function isCompanionSuppressed({
  isCompanionEnabled,
  isCompanionSuppressedForTyping,
  isMainWindowVisible,
}) {
  return !isCompanionEnabled || isCompanionSuppressedForTyping || isMainWindowVisible
}

function canTriggerCompanionPing({
  isCompanionEnabled,
  isCompanionSuppressedForTyping,
  isMainWindowVisible,
}) {
  return !isCompanionSuppressed({
    isCompanionEnabled,
    isCompanionSuppressedForTyping,
    isMainWindowVisible,
  })
}

function shouldTriggerUnreadPing(previousUnreadCount, nextUnreadCount) {
  if (previousUnreadCount === null || previousUnreadCount === undefined) {
    return false
  }

  return Number(nextUnreadCount || 0) > Number(previousUnreadCount || 0)
}

function shouldReleaseTypingSuppression(reason) {
  return reason === 'pointer'
}

function shouldAutoReleaseTypingSuppression(elapsedMs, inactivityMs) {
  return Number(elapsedMs || 0) >= Number(inactivityMs || 0)
}

module.exports = {
  canTriggerCompanionPing,
  isCompanionSuppressed,
  shouldAutoReleaseTypingSuppression,
  shouldReleaseTypingSuppression,
  shouldTriggerUnreadPing,
}
