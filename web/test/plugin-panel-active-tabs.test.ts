import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

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

describe('plugin panel active tabs persistence', () => {
  let registry: typeof import('../src/plugins/plugin-panel-registry.js')

  before(async () => {
    globalThis.localStorage = createMemoryStorage()
    localStorage.setItem(
      'arousal-plugin-panel-active-tabs',
      JSON.stringify({ leftRail: null, rightRail: 'fixture-notes' }),
    )
    registry = await import('../src/plugins/plugin-panel-registry.js')
  })

  after(() => {
    registry.unregisterPluginPanel('fixture-maze')
    registry.unregisterPluginPanel('fixture-notes')
    registry.setPluginPanelTabHydrating(false)
    registry.pruneActiveTabsNotInRegistry(new Set())
  })

  it('does not clobber persisted rightRail while preferred plugin is still loading', () => {
    const {
      PLUGIN_PANEL_ACTIVE_TAB_STORAGE_KEY,
      fallbackActiveTabsIfStillUnregistered,
      focusPluginPanelTab,
      getActivePanelHtml,
      isPluginPanelActiveTabPending,
      openPluginPanel,
      pluginPanelActiveTabState,
      pruneActiveTabsNotInRegistry,
      registerPluginPanel,
      setPluginPanelHtml,
      setPluginPanelTabHydrating,
      unregisterPluginPanel,
    } = registry

    pluginPanelActiveTabState.value = {
      leftRail: null,
      rightRail: 'fixture-notes',
    }
    localStorage.setItem(
      PLUGIN_PANEL_ACTIVE_TAB_STORAGE_KEY,
      JSON.stringify(pluginPanelActiveTabState.value),
    )

    registerPluginPanel({
      placement: 'rightRail',
      pluginId: 'fixture-maze',
      tabIcon: 'mdi-maze',
      tabLabelKey: 'plugins.fixture-maze.label',
      routes: ['chat'],
    })
    setPluginPanelHtml('rightRail', 'fixture-maze', '<div>maze</div>')

    assert.equal(isPluginPanelActiveTabPending('rightRail'), true)
    assert.equal(getActivePanelHtml('rightRail', 'chat'), null)
    assert.equal(pluginPanelActiveTabState.value.rightRail, 'fixture-notes')
    assert.equal(
      localStorage.getItem(PLUGIN_PANEL_ACTIVE_TAB_STORAGE_KEY),
      JSON.stringify({ leftRail: null, rightRail: 'fixture-notes' }),
    )

    focusPluginPanelTab('rightRail', undefined, 'chat')
    assert.equal(pluginPanelActiveTabState.value.rightRail, 'fixture-notes')

    setPluginPanelTabHydrating(true)
    openPluginPanel('rightRail', 'fixture-maze', 'chat')
    assert.equal(pluginPanelActiveTabState.value.rightRail, 'fixture-notes')
    setPluginPanelTabHydrating(false)

    registerPluginPanel({
      placement: 'rightRail',
      pluginId: 'fixture-notes',
      tabIcon: 'mdi-note',
      tabLabelKey: 'plugins.fixture-notes.label',
      routes: ['chat'],
    })
    setPluginPanelHtml('rightRail', 'fixture-notes', '<div>notes</div>')

    assert.equal(isPluginPanelActiveTabPending('rightRail'), false)
    const active = getActivePanelHtml('rightRail', 'chat')
    assert.equal(active?.pluginId, 'fixture-notes')
    assert.equal(pluginPanelActiveTabState.value.rightRail, 'fixture-notes')

    unregisterPluginPanel('fixture-notes')
    assert.equal(isPluginPanelActiveTabPending('rightRail'), true)
    fallbackActiveTabsIfStillUnregistered('chat')
    assert.equal(pluginPanelActiveTabState.value.rightRail, 'fixture-maze')

    pruneActiveTabsNotInRegistry(new Set(['fixture-maze']))
    assert.equal(pluginPanelActiveTabState.value.rightRail, 'fixture-maze')
    pruneActiveTabsNotInRegistry(new Set())
    assert.equal(pluginPanelActiveTabState.value.rightRail, null)

    unregisterPluginPanel('fixture-maze')
  })
})
