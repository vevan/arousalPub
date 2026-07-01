import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyComposerSlashExample,
  getComposerSlashMenuContext,
} from '../../src/utils/composer-slash-menu.js'
import { filterComposerSlashCommands, mergeComposerSlashCatalog } from '../../src/utils/composer-slash-catalog.js'

describe('getComposerSlashMenuContext', () => {
  it('active on first line starting with slash', () => {
    const ctx = getComposerSlashMenuContext('/go', 3)
    assert.ok(ctx)
    assert.equal(ctx.commandQuery, 'go')
    assert.equal(ctx.lineStart, 0)
    assert.equal(ctx.lineEnd, 3)
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

describe('applyComposerSlashExample', () => {
  it('replaces first slash line', () => {
    const ctx = getComposerSlashMenuContext('/g', 2)!
    const { next, cursor } = applyComposerSlashExample('/g', ctx, '/goto 3')
    assert.equal(next, '/goto 3 ')
    assert.equal(cursor, '/goto 3 '.length)
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
