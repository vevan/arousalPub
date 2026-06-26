import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeSettingsSchema,
  validatePluginSettings,
} from '../src/plugin-system/settings-schema.js'

describe('plugin settings text maxLength', () => {
  it('maxLength 0 keeps full text in objectList item fields', () => {
    const schema = normalizeSettingsSchema({
      version: 1,
      fields: [
        {
          key: 'bundleList',
          type: 'objectList',
          labelKey: 'x',
          itemFields: [
            {
              key: 'template',
              type: 'text',
              labelKey: 't',
              maxLength: 0,
            },
          ],
        },
      ],
    })
    assert.ok(schema)
    const long = 'x'.repeat(12_000)
    const out = validatePluginSettings(schema, {
      schemaVersion: 1,
      bundleList: JSON.stringify([{ id: 'a1', label: 'L', template: long }]),
    })
    const items = JSON.parse(String(out.bundleList)) as {
      template: string
    }[]
    assert.equal(items[0]?.template.length, 12_000)
  })

  it('default text field still clips at 8000', () => {
    const schema = normalizeSettingsSchema({
      version: 1,
      fields: [
        {
          key: 'body',
          type: 'text',
          labelKey: 'b',
        },
      ],
    })
    assert.ok(schema)
    const long = 'y'.repeat(9000)
    const out = validatePluginSettings(schema, {
      schemaVersion: 1,
      body: long,
    })
    assert.equal(String(out.body).length, 8000)
  })
})
