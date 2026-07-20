import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePlotSlashArgs } from '../src/parse-plot-slash.js'

describe('parsePlotSlashArgs', () => {
  it('empty args → bare', () => {
    assert.deepEqual(parsePlotSlashArgs(''), { ok: true, kind: 'bare' })
    assert.deepEqual(parsePlotSlashArgs('  '), { ok: true, kind: 'bare' })
  })

  it('summary with and without range', () => {
    assert.deepEqual(parsePlotSlashArgs('summary'), { ok: true, kind: 'summary' })
    assert.deepEqual(parsePlotSlashArgs('summary 99-150'), {
      ok: true,
      kind: 'summary',
      scopeStart: 99,
      scopeEnd: 150,
    })
  })

  it('rejects bad summary range', () => {
    assert.equal(parsePlotSlashArgs('summary 150-99').ok, false)
    assert.equal(parsePlotSlashArgs('summary abc').ok, false)
    assert.equal(parsePlotSlashArgs('summary 1-2 extra').ok, false)
  })

  it('sidecar unquoted name + optional range', () => {
    assert.deepEqual(parsePlotSlashArgs('sidecar items'), {
      ok: true,
      kind: 'sidecar',
      entryName: 'items',
    })
    assert.deepEqual(parsePlotSlashArgs('sidecar items 99-150'), {
      ok: true,
      kind: 'sidecar',
      entryName: 'items',
      scopeStart: 99,
      scopeEnd: 150,
    })
  })

  it('sidecar quoted name with spaces', () => {
    assert.deepEqual(parsePlotSlashArgs('sidecar "My Lore"'), {
      ok: true,
      kind: 'sidecar',
      entryName: 'My Lore',
    })
    assert.deepEqual(parsePlotSlashArgs('sidecar "My Lore" 10-20'), {
      ok: true,
      kind: 'sidecar',
      entryName: 'My Lore',
      scopeStart: 10,
      scopeEnd: 20,
    })
  })

  it('rejects unquoted multi-word name', () => {
    const r = parsePlotSlashArgs('sidecar My Lore 99-150')
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'unquoted_spaces')
  })

  it('rejects unclosed quote / missing entry / unknown type', () => {
    assert.equal(parsePlotSlashArgs('sidecar "open').ok, false)
    assert.equal(parsePlotSlashArgs('sidecar').ok, false)
    assert.equal(parsePlotSlashArgs('foo').ok, false)
  })
})
