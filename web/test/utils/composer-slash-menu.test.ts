import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyComposerSlashCommand,
  getComposerSlashMenuContext,
  isComposerSlashCommandFullyMatched,
  slashCommandToken,
} from '../../src/utils/composer-slash-menu.js'
import { filterComposerSlashCommands, mergeComposerSlashCatalog } from '../../src/utils/composer-slash-catalog.js'

describe('getComposerSlashMenuContext', () => {
  it('active on first line starting with slash', () => {
    const ctx = getComposerSlashMenuContext('/go', 3)
    assert.ok(ctx)
    assert.equal(ctx.commandQuery, 'go')
    assert.equal(ctx.lineStart, 0)
    assert.equal(ctx.lineEnd, 3)
    assert.equal(ctx.slashStart, 0)
    assert.equal(ctx.insertEnd, 3)
  })

  it('inactive on second line', () => {
    const ctx = getComposerSlashMenuContext('/goto 1\nhi', 10)
    assert.equal(ctx, null)
  })

  it('inactive when body has slash not at line start', () => {
    const ctx = getComposerSlashMenuContext('hello /goto', 11)
    assert.equal(ctx, null)
  })
})

describe('applyComposerSlashCommand', () => {
  it('inserts command token and keeps text after cursor', () => {
    const ctx = getComposerSlashMenuContext('/g hello', 2)!
    const { next, cursor } = applyComposerSlashCommand('/g hello', ctx, 'goto', 2)
    assert.equal(next, '/goto hello')
    assert.equal(cursor, '/goto '.length)
  })

  it('inserts command only without example args', () => {
    const ctx = getComposerSlashMenuContext('/g', 2)!
    const { next, cursor } = applyComposerSlashCommand('/g', ctx, 'goto', 2)
    assert.equal(next, '/goto ')
    assert.equal(cursor, '/goto '.length)
  })

  it('uses @ token for at command', () => {
    assert.equal(slashCommandToken('@'), '/@')
    const ctx = getComposerSlashMenuContext('/@', 2)!
    const { next } = applyComposerSlashCommand('/@', ctx, '@', 2)
    assert.equal(next, '/@ ')
  })
})

describe('isComposerSlashCommandFullyMatched', () => {
  it('matches exact command id', () => {
    const ids = mergeComposerSlashCatalog([]).map((c) => c.id)
    assert.equal(isComposerSlashCommandFullyMatched('goto', ids), true)
    assert.equal(isComposerSlashCommandFullyMatched('go', ids), false)
    assert.equal(isComposerSlashCommandFullyMatched('@', ids), true)
  })
})

describe('filterComposerSlashCommands', () => {
  it('filters by id prefix', () => {
    const all = mergeComposerSlashCatalog([])
    const hit = filterComposerSlashCommands(all, 'go')
    assert.equal(hit.length, 1)
    assert.equal(hit[0]?.id, 'goto')
  })
})
