import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assemblePrompts,
  compactEmptyMessages,
  compareInjectionEntries,
  type PromptEntry,
  type PromptGroup,
  type PromptPreset,
} from './assemble-prompts.js'

const T = new Date().toISOString()

function makeEntry(
  partial: Partial<PromptEntry> & Pick<PromptEntry, 'id' | 'groupId' | 'content'>,
): PromptEntry {
  return {
    title: partial.title ?? partial.id,
    description: '',
    tags: [],
    enabled: true,
    role: 'system',
    injectionPosition: 'relative',
    injectionDepth: 0,
    injectionOrder: 100,
    triggers: [],
    order: 0,
    createdAt: T,
    updatedAt: T,
    ...partial,
  }
}

function makeGroup(partial: Partial<PromptGroup> & Pick<PromptGroup, 'id' | 'kind'>): PromptGroup {
  return {
    name: partial.id,
    order: 0,
    enabled: true,
    ...partial,
  }
}

function makePreset(
  groups: PromptGroup[],
  prompts: PromptEntry[],
): PromptPreset {
  return {
    id: 'preset-test',
    name: 'Test',
    groups,
    prompts,
    createdAt: T,
    updatedAt: T,
  }
}

describe('assemblePrompts group.enabled', () => {
  it('skips custom entries in a disabled normal group', () => {
    const pre = makeGroup({ id: 'g-pre', kind: 'normal', order: 0, enabled: false })
    const preset = makePreset(
      [pre],
      [
        makeEntry({
          id: 'e1',
          groupId: 'g-pre',
          content: 'custom-pre',
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset)
    assert.equal(messages.some((m) => m.content === 'custom-pre'), false)
  })

  it('keeps world binding when group custom entries are disabled', () => {
    const world = makeGroup({ id: 'g-world', kind: 'world', order: 0, enabled: false })
    const preset = makePreset(
      [world],
      [
        makeEntry({
          id: 'bound-world',
          groupId: 'g-world',
          content: '',
          bindingSlot: 'boundWorld',
          order: 0,
        }),
        makeEntry({
          id: 'extra',
          groupId: 'g-world',
          content: 'world-custom',
          order: 1,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      world: '<lore>castle</lore>',
    })
    assert.equal(messages.some((m) => m.content.includes('castle')), true)
    assert.equal(messages.some((m) => m.content === 'world-custom'), false)
  })

  it('skips chat-depth custom entries when their group is disabled', () => {
    const post = makeGroup({ id: 'g-post', kind: 'normal', order: 0, enabled: false })
    const preset = makePreset(
      [post],
      [
        makeEntry({
          id: 'chat-depth',
          groupId: 'g-post',
          content: 'depth-inject',
          injectionPosition: 'chat',
          injectionDepth: 0,
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset)
    assert.equal(messages.some((m) => m.content === 'depth-inject'), false)
  })

  it('does not change entry.enabled when group is disabled (assembly only)', () => {
    const pre = makeGroup({ id: 'g-pre', kind: 'normal', order: 0, enabled: false })
    const entry = makeEntry({
      id: 'e1',
      groupId: 'g-pre',
      content: 'still-on',
      enabled: true,
      order: 0,
    })
    const preset = makePreset([pre], [entry])
    assemblePrompts(preset)
    assert.equal(preset.prompts[0]?.enabled, true)
  })
})

describe('assemblePrompts history group order', () => {
  const history = makeGroup({ id: 'g-history', kind: 'history', order: 0 })

  it('injects custom entries before and after the history bundle by order', () => {
    const preset = makePreset(
      [history],
      [
        makeEntry({
          id: 'before',
          groupId: 'g-history',
          content: 'hist-before',
          order: 0,
        }),
        makeEntry({
          id: 'bound-post',
          groupId: 'g-history',
          content: '',
          bindingSlot: 'boundCharacterPostHistory',
          order: 1,
        }),
        makeEntry({
          id: 'after',
          groupId: 'g-history',
          content: 'hist-after',
          order: 2,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      history: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
      ],
      characterPostHistory: 'post-block',
    })
    const contents = messages.map((m) => m.content)
    assert.deepEqual(contents, [
      'hist-before',
      'u1',
      'a1',
      'post-block',
      'hist-after',
    ])
  })

  it('always injects recent history even without a binding slot entry', () => {
    const preset = makePreset(
      [history],
      [
        makeEntry({
          id: 'custom',
          groupId: 'g-history',
          content: 'only-custom',
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      history: [{ role: 'user', content: 'hello' }],
    })
    assert.deepEqual(messages.map((m) => m.content), ['only-custom', 'hello'])
  })

  it('injects post history immediately after recent history inside the bundle', () => {
    const preset = makePreset(
      [history],
      [
        makeEntry({
          id: 'bound-post',
          groupId: 'g-history',
          content: '',
          bindingSlot: 'boundCharacterPostHistory',
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      history: [{ role: 'user', content: 'hello' }],
      characterPostHistory: 'stay-in-character',
    })
    assert.deepEqual(
      messages.map((m) => m.content),
      ['hello', 'stay-in-character'],
    )
  })

  it('skips post history when the binding slot is disabled but still injects chat history', () => {
    const preset = makePreset(
      [history],
      [
        makeEntry({
          id: 'bound-post',
          groupId: 'g-history',
          content: '',
          bindingSlot: 'boundCharacterPostHistory',
          enabled: false,
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      history: [{ role: 'user', content: 'hello' }],
      characterPostHistory: 'post-only',
    })
    assert.deepEqual(messages.map((m) => m.content), ['hello'])
  })
})

describe('compareInjectionEntries', () => {
  it('uses depth desc before anchor by default', () => {
    const deep = makeEntry({
      id: 'deep',
      groupId: 'g',
      content: '',
      injectionDepth: 4,
      order: 1,
    })
    const shallow = makeEntry({
      id: 'shallow',
      groupId: 'g',
      content: '',
      injectionDepth: 2,
      order: 0,
    })
    assert.ok(compareInjectionEntries(deep, shallow) < 0)
  })

  it('breaks ties with injectionOrder then order then role', () => {
    const a = makeEntry({
      id: 'a',
      groupId: 'g',
      content: '',
      injectionOrder: 50,
      order: 0,
      role: 'assistant',
    })
    const b = makeEntry({
      id: 'b',
      groupId: 'g',
      content: '',
      injectionOrder: 100,
      order: 0,
      role: 'system',
    })
    assert.ok(compareInjectionEntries(a, b) < 0)

    const orderFirst = makeEntry({ id: 'o0', groupId: 'g', content: '', order: 0 })
    const orderSecond = makeEntry({ id: 'o1', groupId: 'g', content: '', order: 1 })
    assert.ok(compareInjectionEntries(orderFirst, orderSecond) < 0)

    const assistant = makeEntry({
      id: 'as',
      groupId: 'g',
      content: '',
      role: 'assistant',
    })
    const user = makeEntry({ id: 'us', groupId: 'g', content: '', role: 'user' })
    assert.ok(compareInjectionEntries(assistant, user) < 0)
  })
})

describe('assemblePrompts injection tie-break', () => {
  it('sorts before-bundle relative entries by depth desc', () => {
    const history = makeGroup({ id: 'g-history', kind: 'history', order: 0 })
    const preset = makePreset(
      [history],
      [
        makeEntry({
          id: 'shallow',
          groupId: 'g-history',
          content: 'depth-2',
          injectionDepth: 2,
          order: 1,
        }),
        makeEntry({
          id: 'deep',
          groupId: 'g-history',
          content: 'depth-4',
          injectionDepth: 4,
          order: 0,
        }),
        makeEntry({
          id: 'bound-post',
          groupId: 'g-history',
          content: '',
          bindingSlot: 'boundCharacterPostHistory',
          order: 2,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      history: [{ role: 'user', content: 'hi' }],
    })
    const before = messages.slice(0, 2).map((m) => m.content)
    assert.deepEqual(before, ['depth-4', 'depth-2'])
  })

  it('sorts chat-depth entries by order at the same depth after user input', () => {
    const pre = makeGroup({ id: 'g-pre', kind: 'normal', order: 0 })
    const post = makeGroup({ id: 'g-post', kind: 'normal', order: 1 })
    const ui = makeGroup({ id: 'g-ui', kind: 'userInput', order: 2 })
    const preset = makePreset(
      [pre, post, ui],
      [
        makeEntry({
          id: 'base',
          groupId: 'g-pre',
          content: 'base',
          order: 0,
        }),
        makeEntry({
          id: 'second',
          groupId: 'g-post',
          content: 'chat-second',
          injectionPosition: 'chat',
          injectionDepth: 0,
          order: 1,
        }),
        makeEntry({
          id: 'first',
          groupId: 'g-post',
          content: 'chat-first',
          injectionPosition: 'chat',
          injectionDepth: 0,
          order: 0,
        }),
        makeEntry({
          id: 'bound-ui',
          groupId: 'g-ui',
          content: '',
          bindingSlot: 'boundUserInput',
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, { userInput: 'turn' })
    const tail = messages.slice(-3).map((m) => m.content)
    assert.deepEqual(tail, ['turn', 'chat-first', 'chat-second'])
  })
})

describe('compactEmptyMessages', () => {
  it('drops messages whose content is empty after trim', () => {
    assert.deepEqual(
      compactEmptyMessages([
        { role: 'system', content: '' },
        { role: 'system', content: '  \n  ' },
        { role: 'user', content: 'hi' },
      ]),
      [{ role: 'user', content: 'hi' }],
    )
  })
})

describe('assemblePrompts character/user split', () => {
  const character = makeGroup({ id: 'g-char', kind: 'character', order: 0 })

  it('injects character and user blocks with custom entries between', () => {
    const preset = makePreset(
      [character],
      [
        makeEntry({
          id: 'before',
          groupId: 'g-char',
          content: 'before-char',
          order: 0,
        }),
        makeEntry({
          id: 'bound-char',
          groupId: 'g-char',
          content: '',
          bindingSlot: 'boundCharacterSystem',
          order: 1,
        }),
        makeEntry({
          id: 'between',
          groupId: 'g-char',
          content: 'between',
          order: 2,
        }),
        makeEntry({
          id: 'bound-user',
          groupId: 'g-char',
          content: '',
          bindingSlot: 'boundUserPersona',
          order: 3,
        }),
        makeEntry({
          id: 'after',
          groupId: 'g-char',
          content: 'after-user',
          order: 4,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      characters: [{ cardBody: 'CHAR', systemPrompt: 'CHAR-SP' }],
      userCharacter: { cardBody: 'USER', systemPrompt: 'USER-SP' },
    })
    assert.deepEqual(
      messages.map((m) => m.content),
      ['before-char', 'CHAR-SP', 'CHAR', 'between', 'USER-SP\n\nUSER', 'after-user'],
    )
  })

  it('removes empty custom entries after noop macro expansion', () => {
    const pre = makeGroup({ id: 'g-pre', kind: 'normal', order: 0 })
    const preset = makePreset(
      [pre],
      [
        makeEntry({
          id: 'empty',
          groupId: 'g-pre',
          content: '{{noop}}',
          order: 0,
        }),
        makeEntry({
          id: 'kept',
          groupId: 'g-pre',
          content: 'visible',
          order: 1,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      macroContext: {
        userName: 'u',
        characterNames: ['c'],
        now: new Date('2026-01-01T00:00:00.000Z'),
        locale: 'en',
      },
    })
    assert.deepEqual(messages.map((m) => m.content), ['visible'])
  })
})
