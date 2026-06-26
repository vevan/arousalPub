import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getMemoizedPreferencesDoc,
  runWithRequestPreferencesMemo,
  setMemoizedPreferencesDoc,
} from '../src/request-preferences-memo.js'

describe('request preferences memo', () => {
  it('scopes cache to request context', () => {
    runWithRequestPreferencesMemo(() => {
      assert.equal(getMemoizedPreferencesDoc(), undefined)
      setMemoizedPreferencesDoc({ version: 1, savedAt: 't' })
      assert.equal(getMemoizedPreferencesDoc()?.version, 1)
    })
    assert.equal(getMemoizedPreferencesDoc(), undefined)
  })
})
