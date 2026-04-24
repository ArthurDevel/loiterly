'use strict'

const SEMVER_LABEL_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

function sanitizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^[^\d]*/, '')
    .replace(/[^\d.].*$/, '')
}

function compareVersions(left, right) {
  const leftParts = sanitizeVersion(left).split('.').filter(Boolean).map((part) => Number.parseInt(part, 10) || 0)
  const rightParts = sanitizeVersion(right).split('.').filter(Boolean).map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0
    const rightValue = rightParts[index] || 0

    if (leftValue > rightValue) {
      return 1
    }

    if (leftValue < rightValue) {
      return -1
    }
  }

  return 0
}

function normalizeSemverLabel(value) {
  const normalized = String(value || '').trim()
  if (!SEMVER_LABEL_PATTERN.test(normalized)) {
    return ''
  }

  return sanitizeVersion(normalized)
}

function releaseVersionFromPayload(release) {
  return normalizeSemverLabel(release?.tag_name) || normalizeSemverLabel(release?.name)
}

module.exports = {
  compareVersions,
  releaseVersionFromPayload,
  sanitizeVersion,
}
