import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { LOCALE_PREF_STORAGE_KEY } from '../i18n/locale.js'
import { COMPOSER_DRAFT_STORAGE_PREFIX } from './composer-draft-storage.js'
import {
  clearUserSessionLocalStorage,
  clearUserSessionStorage,
} from './user-session-storage.js'

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

describe('clearUserSessionLocalStorage', () => {
  beforeEach(() => {
    globalThis.localStorage = createMemoryStorage()
    globalThis.sessionStorage = createMemoryStorage()
  })

  it('removes user session keys but keeps device prefs', () => {
    localStorage.setItem('arousal-locale-pref', 'zh')
    localStorage.setItem('arousal-theme', 'dark')
    localStorage.setItem('arousal-default-user-id', '00000000')
    localStorage.setItem('arousal-embedding-api-key-id', 'secret-ref')
    localStorage.setItem(
      `${COMPOSER_DRAFT_STORAGE_PREFIX}:u1:conv1`,
      'draft text',
    )
    localStorage.setItem('arousal-memory-topk', '12')
    localStorage.setItem('other-app-key', 'keep')

    clearUserSessionLocalStorage()

    assert.equal(localStorage.getItem(LOCALE_PREF_STORAGE_KEY), 'zh')
    assert.equal(localStorage.getItem('arousal-theme'), 'dark')
    assert.equal(localStorage.getItem('arousal-default-user-id'), '00000000')
    assert.equal(localStorage.getItem('arousal-embedding-api-key-id'), null)
    assert.equal(
      localStorage.getItem(`${COMPOSER_DRAFT_STORAGE_PREFIX}:u1:conv1`),
      null,
    )
    assert.equal(localStorage.getItem('arousal-memory-topk'), null)
    assert.equal(localStorage.getItem('other-app-key'), 'keep')
  })
})

describe('clearUserSessionStorage', () => {
  beforeEach(() => {
    globalThis.sessionStorage = createMemoryStorage()
  })

  it('clears sessionStorage', () => {
    sessionStorage.setItem('arousal-home-return', '1')
    clearUserSessionStorage()
    assert.equal(sessionStorage.length, 0)
  })
})
