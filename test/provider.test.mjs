import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, Config, inject, name } from '../index.js'

test('the packaged Brave provider exposes its loader contract without searching', () => {
  assert.equal(typeof apply, 'function')
  assert.equal(name, 'web-search-brave-moe4all')
  assert.deepEqual(inject, ['web'])
  assert.equal(Config({}).apiKeyEnv, 'BRAVE_API_KEY')
})

test('invalid throttle and retry settings are refused by the public schema', () => {
  assert.throws(() => Config({ throttleMs: -1 }))
  assert.throws(() => Config({ maxAttempts: 0 }))
})
