import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  apiPresetDisplayName,
  formatPluginApiPresetEffectiveHint,
  resolveGlobalPluginApiPresetEffective,
  resolvePluginApiPresetEffective,
} from '../src/utils/plugin-api-preset-effective.js'

describe('resolvePluginApiPresetEffective', () => {
  it('prefers conversation over global plugin and default', () => {
    assert.deepEqual(
      resolvePluginApiPresetEffective({
        conversationApiConfigId: 'conv-p',
        globalPluginApiConfigId: 'global-p',
        activePresetId: 'default-p',
      }),
      { presetId: 'conv-p', source: 'conversation' },
    )
  })

  it('falls back to global plugin then active preset', () => {
    assert.deepEqual(
      resolvePluginApiPresetEffective({
        conversationApiConfigId: '',
        globalPluginApiConfigId: 'global-p',
        activePresetId: 'default-p',
      }),
      { presetId: 'global-p', source: 'global_plugin' },
    )
    assert.deepEqual(
      resolvePluginApiPresetEffective({
        globalPluginApiConfigId: '',
        activePresetId: 'default-p',
      }),
      { presetId: 'default-p', source: 'global_default' },
    )
  })
})

describe('resolveGlobalPluginApiPresetEffective', () => {
  it('uses global plugin apiConfigId or active preset', () => {
    assert.deepEqual(
      resolveGlobalPluginApiPresetEffective({
        globalPluginApiConfigId: 'p1',
        activePresetId: 'p2',
      }),
      { presetId: 'p1', source: 'global_plugin' },
    )
    assert.deepEqual(
      resolveGlobalPluginApiPresetEffective({
        globalPluginApiConfigId: '',
        activePresetId: 'p2',
      }),
      { presetId: 'p2', source: 'global_default' },
    )
  })
})

describe('apiPresetDisplayName', () => {
  it('returns alias only, never raw id', () => {
    assert.equal(
      apiPresetDisplayName('uuid-1', {
        selectItems: [{ value: 'uuid-1', title: 'Main GPT' }],
      }),
      'Main GPT',
    )
    assert.equal(
      apiPresetDisplayName('uuid-1', {
        selectItems: [{ value: 'uuid-1', title: 'uuid-1' }],
        presets: [{ id: 'uuid-1', alias: 'Fallback Name' }],
      }),
      'Fallback Name',
    )
    assert.equal(
      apiPresetDisplayName('uuid-1', {
        selectItems: [{ value: 'uuid-1', title: 'uuid-1' }],
      }),
      null,
    )
  })
})

describe('formatPluginApiPresetEffectiveHint', () => {
  const t = (key: string, params?: Record<string, string>) => {
    if (key === 'settings.plugins.apiPresetEffectiveLine' && params) {
      return `当前生效预设：${params.source} - ${params.name}`
    }
    const map: Record<string, string> = {
      'settings.plugins.apiPresetEffectiveSourceConversation': '本对话',
      'settings.plugins.apiPresetEffectiveSourceGlobalPlugin': '全局插件',
      'settings.plugins.apiPresetEffectiveSourceGlobalDefault': '全局默认',
    }
    return map[key] ?? key
  }

  it('formats source and preset name without id', () => {
    assert.equal(
      formatPluginApiPresetEffectiveHint(
        { presetId: 'uuid-1', source: 'global_default' },
        'Main GPT',
        t,
      ),
      '当前生效预设：全局默认 - Main GPT',
    )
    assert.equal(
      formatPluginApiPresetEffectiveHint(
        { presetId: 'uuid-1', source: 'conversation' },
        null,
        t,
      ),
      null,
    )
  })
})
