import assert from 'node:assert/strict'
import { describe, it, afterEach } from 'node:test'
import { resolveMacroEngine } from './config.js'

describe('resolveMacroEngine', () => {
  const prev = process.env.MACRO_ENGINE

  afterEach(() => {
    if (prev === undefined) delete process.env.MACRO_ENGINE
    else process.env.MACRO_ENGINE = prev
  })

  it('defaults to cst when unset (D3)', () => {
    delete process.env.MACRO_ENGINE
    assert.equal(resolveMacroEngine(), 'cst')
  })

  it('reads MACRO_ENGINE env (overrides config.json)', () => {
    process.env.MACRO_ENGINE = 'cst'
    assert.equal(resolveMacroEngine(), 'cst')
    process.env.MACRO_ENGINE = 'LEGACY'
    assert.equal(resolveMacroEngine(), 'cst')
  })

  it('ignores invalid env values', () => {
    process.env.MACRO_ENGINE = 'handlebars'
    assert.equal(resolveMacroEngine(), 'cst')
  })
})
