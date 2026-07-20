import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import {
  canSubmitComposerInput,
  parseAtSlashDisplayNames,
  parseComposerSubmit,
  submitComposerParse,
} from '../../src/utils/composer-slash.js'
import {
  clearComposerSlashPluginCommandsForTests,
  getComposerSlashPluginHandler,
  registerComposerSlashCommand,
  unregisterComposerSlashCommandsForPlugin,
} from '../../src/utils/composer-slash-registry.js'

describe('parseComposerSubmit', () => {
  it('plain message without slash', () => {
    const r = parseComposerSubmit('hello @Alice')
    assert.equal(r.body, 'hello @Alice')
    assert.deepEqual(r.commands, [])
  })

  it('/goto strips command and leaves no body', () => {
    const r = parseComposerSubmit('/goto 3')
    assert.deepEqual(r.commands, [{ kind: 'goto', turnOrdinal: 3 }])
    assert.equal(r.body, '')
  })

  it('/goto then message body on following lines', () => {
    const r = parseComposerSubmit('/goto 2\n\nhello')
    assert.deepEqual(r.commands, [{ kind: 'goto', turnOrdinal: 2 }])
    assert.equal(r.body, 'hello')
  })

  it('unknown slash stops parsing and keeps line as body', () => {
    const r = parseComposerSubmit('/foo bar\nhello')
    assert.deepEqual(r.commands, [])
    assert.equal(r.body, '/foo bar\nhello')
  })

  it('/@ with bound names and inline remainder', () => {
    const r = parseComposerSubmit('/@ Alice Betty 你们俩说说', {
      boundDisplayNames: ['Alice', 'Betty'],
    })
    assert.deepEqual(r.commands, [{ kind: 'at', names: ['Alice', 'Betty'] }])
    assert.equal(r.body, '你们俩说说')
  })

  it('merges multiple /@ lines into speaker queue', () => {
    const r = parseComposerSubmit('/@ Alice\n/@ Betty\nhello', {
      boundDisplayNames: ['Alice', 'Betty'],
    })
    assert.deepEqual(r.commands, [
      { kind: 'at', names: ['Alice'] },
      { kind: 'at', names: ['Betty'] },
    ])
    assert.equal(r.body, 'hello')
    assert.deepEqual(
      submitComposerParse('/@ Alice\n/@ Betty\nhello', {
        boundDisplayNames: ['Alice', 'Betty'],
      }).speakerQueue,
      ['Alice', 'Betty'],
    )
  })

  it('/@ with case-insensitive bound name and inline remainder', () => {
    const r = parseComposerSubmit('/@ betty 你怎么看', {
      boundDisplayNames: ['Alice', 'Betty'],
    })
    assert.deepEqual(r.commands, [{ kind: 'at', names: ['Betty'] }])
    assert.equal(r.body, '你怎么看')
    assert.deepEqual(
      submitComposerParse('/@ betty 你怎么看', {
        boundDisplayNames: ['Alice', 'Betty'],
      }).speakerQueue,
      ['Betty'],
    )
  })

  it('unmatched /@ name stays in body remainder', () => {
    const r = parseComposerSubmit('/@ betty 你怎么看', {
      boundDisplayNames: ['Alice'],
    })
    assert.deepEqual(r.commands, [{ kind: 'at', names: [] }])
    assert.equal(r.body, 'betty 你怎么看')
  })
})

describe('parseAtSlashDisplayNames', () => {
  it('matches space-separated display names', () => {
    const r = parseAtSlashDisplayNames('Alice Betty 你们俩', ['Alice', 'Betty'])
    assert.deepEqual(r.names, ['Alice', 'Betty'])
    assert.equal(r.remainder, '你们俩')
  })
})

describe('canSubmitComposerInput', () => {
  it('allows goto-only without chat body', () => {
    assert.equal(canSubmitComposerInput('/goto 0'), true)
    assert.equal(canSubmitComposerInput('   '), false)
  })
})

describe('submitComposerParse', () => {
  it('collects speakerQueue', () => {
    const r = submitComposerParse('/@ Alice hi', { boundDisplayNames: ['Alice'] })
    assert.deepEqual(r.speakerQueue, ['Alice'])
    assert.equal(r.body, 'hi')
  })
})

describe('plugin slash (generic fixture)', () => {
  beforeEach(() => {
    clearComposerSlashPluginCommandsForTests()
  })
  afterEach(() => {
    clearComposerSlashPluginCommandsForTests()
  })

  it('registered command is stripped from body and parsed as plugin', () => {
    registerComposerSlashCommand('fixture-cmd', () => undefined, {
      example: '/fixture-cmd demo',
    })
    const r = parseComposerSubmit('/fixture-cmd alpha beta')
    assert.deepEqual(r.commands, [
      { kind: 'plugin', name: 'fixture-cmd', args: 'alpha beta' },
    ])
    assert.equal(r.body, '')
  })

  it('allows plugin-only submit without chat body', () => {
    registerComposerSlashCommand('fixture-cmd', () => undefined)
    assert.equal(canSubmitComposerInput('/fixture-cmd'), true)
  })

  it('plugin command with following body still parses both (host send policy blocks)', () => {
    registerComposerSlashCommand('fixture-cmd', () => undefined)
    const r = parseComposerSubmit('/fixture-cmd args\nhello')
    assert.deepEqual(r.commands, [
      { kind: 'plugin', name: 'fixture-cmd', args: 'args' },
    ])
    assert.equal(r.body, 'hello')
    assert.equal(canSubmitComposerInput('/fixture-cmd args\nhello'), true)
  })

  it('unregisterComposerSlashCommandsForPlugin removes only that plugin', () => {
    registerComposerSlashCommand(
      'fixture-cmd',
      () => undefined,
      { pluginId: 'fixture-plugin-a' },
    )
    registerComposerSlashCommand(
      'other-cmd',
      () => undefined,
      { pluginId: 'fixture-plugin-b' },
    )
    unregisterComposerSlashCommandsForPlugin('fixture-plugin-a')
    assert.equal(getComposerSlashPluginHandler('fixture-cmd'), undefined)
    assert.ok(getComposerSlashPluginHandler('other-cmd'))
    const r = parseComposerSubmit('/fixture-cmd alone')
    assert.deepEqual(r.commands, [])
    assert.equal(r.body, '/fixture-cmd alone')
  })

  it('unregistered slash remains body (no host specialization)', () => {
    const r = parseComposerSubmit('/fixture-cmd alone')
    assert.deepEqual(r.commands, [])
    assert.equal(r.body, '/fixture-cmd alone')
  })
})
