import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { usePluginUserSettingsStore } from '../../src/stores/plugin-user-settings.js'

describe('usePluginUserSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('setBag marks loaded and getSnapshot shallow-copies', () => {
    const store = usePluginUserSettingsStore()
    store.setBag('fixture-plugin-a', { foo: 1 }, { notify: false })
    assert.equal(store.isLoaded('fixture-plugin-a'), true)
    const snap = store.getSnapshot('fixture-plugin-a')
    assert.deepEqual(snap, { foo: 1 })
    snap.foo = 2
    assert.deepEqual(store.getSnapshot('fixture-plugin-a'), { foo: 1 })
  })

  it('subscribe receives settings on setBag notify', () => {
    const store = usePluginUserSettingsStore()
    let seen: Record<string, unknown> | null = null
    store.subscribe('fixture-plugin-b', (settings) => {
      seen = settings
    })
    store.setBag('fixture-plugin-b', { enabled: true })
    assert.deepEqual(seen, { enabled: true })
  })

  it('invalidate drops cache without notifying', () => {
    const store = usePluginUserSettingsStore()
    let calls = 0
    store.subscribe('p', () => {
      calls += 1
    })
    store.setBag('p', { a: 1 }, { notify: false })
    store.invalidate('p')
    assert.equal(store.isLoaded('p'), false)
    assert.equal(calls, 0)
  })

  it('clearAll resets all plugin bags', () => {
    const store = usePluginUserSettingsStore()
    store.setBag('a', { x: 1 }, { notify: false })
    store.setBag('b', { y: 2 }, { notify: false })
    store.clearAll()
    assert.equal(store.isLoaded('a'), false)
    assert.equal(store.isLoaded('b'), false)
    assert.deepEqual(store.getSnapshot('a'), {})
  })

  it('clearAll clears subscribers so stale handlers are not kept', () => {
    const store = usePluginUserSettingsStore()
    let calls = 0
    store.subscribe('p', () => {
      calls += 1
    })
    store.clearAll()
    store.setBag('p', { fresh: true })
    assert.equal(calls, 0)
  })
})
