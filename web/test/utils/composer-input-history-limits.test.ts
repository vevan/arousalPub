import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  COMPOSER_INPUT_HISTORY_PINNED_MAX_DEFAULT,
  COMPOSER_INPUT_HISTORY_PINNED_MAX_STORAGE_KEY,
  COMPOSER_INPUT_HISTORY_RECENT_MAX_DEFAULT,
  COMPOSER_INPUT_HISTORY_RECENT_MAX_STORAGE_KEY,
  normalizeComposerInputHistoryLimits,
  readComposerInputHistoryLimits,
  writeComposerInputHistoryLimits,
} from '../../src/utils/composer-input-history-limits.js'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.get(key) ?? null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
    removeItem(key: string) {
      map.delete(key)
    },
    key(index: number) {
      return [...map.keys()][index] ?? null
    },
  } as Storage
}

describe('composer-input-history-limits', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage()
  })

  it('defaults pinned 5 recent 10', () => {
    const limits = readComposerInputHistoryLimits()
    assert.equal(limits.pinnedMax, COMPOSER_INPUT_HISTORY_PINNED_MAX_DEFAULT)
    assert.equal(limits.recentMax, COMPOSER_INPUT_HISTORY_RECENT_MAX_DEFAULT)
    assert.equal(limits.pinnedMax, 5)
    assert.equal(limits.recentMax, 10)
  })

  it('clamps and persists limits', () => {
    const saved = writeComposerInputHistoryLimits({
      pinnedMax: 99,
      recentMax: 0,
    })
    assert.equal(saved.pinnedMax, 50)
    assert.equal(saved.recentMax, 1)
    assert.equal(
      localStorage.getItem(COMPOSER_INPUT_HISTORY_PINNED_MAX_STORAGE_KEY),
      '50',
    )
    assert.equal(
      localStorage.getItem(COMPOSER_INPUT_HISTORY_RECENT_MAX_STORAGE_KEY),
      '1',
    )
    assert.deepEqual(readComposerInputHistoryLimits(), saved)
  })

  it('normalizeComposerInputHistoryLimits handles invalid input', () => {
    assert.deepEqual(
      normalizeComposerInputHistoryLimits({
        pinnedMax: 'x',
        recentMax: undefined,
      }),
      { pinnedMax: 5, recentMax: 10 },
    )
  })
})
