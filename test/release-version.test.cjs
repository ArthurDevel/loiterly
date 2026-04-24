'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  compareVersions,
  releaseVersionFromPayload,
} = require('../electron/updater/version.cjs')

test('release versions accept semver tags', () => {
  assert.equal(releaseVersionFromPayload({ tag_name: 'v0.0.4' }), '0.0.4')
  assert.equal(compareVersions('0.0.4', '0.0.4'), 0)
})

test('release versions ignore non-semver tags', () => {
  assert.equal(releaseVersionFromPayload({ tag_name: 'ArthurDevel/release-004' }), '')
})

test('release versions can fall back to a semver release name', () => {
  assert.equal(
    releaseVersionFromPayload({
      tag_name: 'ArthurDevel/release-004',
      name: 'v0.0.4',
    }),
    '0.0.4'
  )
})
