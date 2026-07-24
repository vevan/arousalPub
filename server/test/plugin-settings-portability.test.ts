import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PLUGIN_SETTINGS_EXPORT_FORMAT,
  parsePluginSettingsImportBody,
  PluginSettingsPortabilityError,
} from '../src/plugin-system/settings-portability.js'

const FIXTURE_A = 'fixture-plugin-a'
const FIXTURE_B = 'fixture-plugin-b'

describe('plugin settings portability envelope', () => {
  it('parses a valid envelope', () => {
    const out = parsePluginSettingsImportBody(
      {
        format: PLUGIN_SETTINGS_EXPORT_FORMAT,
        pluginId: FIXTURE_A,
        pluginVersion: '1.0.0',
        exportedAt: '2026-07-24T00:00:00.000Z',
        enabled: false,
        settings: { schemaVersion: 1, foo: 1 },
      },
      FIXTURE_A,
    )
    assert.equal(out.pluginId, FIXTURE_A)
    assert.equal(out.enabled, false)
    assert.equal(out.settings.foo, 1)
    assert.equal(out.pluginVersion, '1.0.0')
  })

  it('rejects format mismatch', () => {
    assert.throws(
      () =>
        parsePluginSettingsImportBody(
          {
            format: 'other',
            pluginId: FIXTURE_A,
            enabled: true,
            settings: {},
          },
          FIXTURE_A,
        ),
      (e: unknown) =>
        e instanceof PluginSettingsPortabilityError &&
        e.code === 'plugin_settings_import_invalid',
    )
  })

  it('rejects pluginId mismatch', () => {
    assert.throws(
      () =>
        parsePluginSettingsImportBody(
          {
            format: PLUGIN_SETTINGS_EXPORT_FORMAT,
            pluginId: FIXTURE_B,
            enabled: true,
            settings: {},
          },
          FIXTURE_A,
        ),
      (e: unknown) =>
        e instanceof PluginSettingsPortabilityError &&
        e.code === 'plugin_settings_plugin_mismatch',
    )
  })

  it('rejects missing enabled', () => {
    assert.throws(
      () =>
        parsePluginSettingsImportBody(
          {
            format: PLUGIN_SETTINGS_EXPORT_FORMAT,
            pluginId: FIXTURE_A,
            settings: {},
          },
          FIXTURE_A,
        ),
      (e: unknown) =>
        e instanceof PluginSettingsPortabilityError &&
        e.code === 'plugin_settings_import_invalid',
    )
  })
})
