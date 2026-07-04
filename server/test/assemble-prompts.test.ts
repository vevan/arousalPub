import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assemblePrompts,
  compactEmptyMessages,
  compareInjectionEntries,
  resolveChatDepthInsertIndex,
  type ChatMessage,
  type PromptEntry,
  type PromptGroup,
  type PromptPreset,
} from '../src/assemble-prompts.js'
import { extractMacroCharacterFields } from '../src/prompt-macros/index.js'

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
      '<char name="角色" attribute="post_history_instructions">post-block</char>',
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
      [
        'hello',
        '<char name="角色" attribute="post_history_instructions">stay-in-character</char>',
      ],
    )
  })

  it('injects chat history when boundChatHistory is disabled but post history is enabled', () => {
    const preset = makePreset(
      [history],
      [
        makeEntry({
          id: 'bound-hist',
          groupId: 'g-history',
          content: '',
          bindingSlot: 'boundChatHistory',
          enabled: false,
          order: 0,
        }),
        makeEntry({
          id: 'bound-post',
          groupId: 'g-history',
          content: '',
          bindingSlot: 'boundCharacterPostHistory',
          order: 1,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      history: [{ role: 'user', content: 'hello' }],
      characterPostHistory: 'post-block',
    })
    assert.deepEqual(
      messages.map((m) => m.content),
      [
        'hello',
        '<char name="角色" attribute="post_history_instructions">post-block</char>',
      ],
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

describe('assemblePrompts audit fixes', () => {
  it('injects world lore only once when before and after slots are both enabled', () => {
    const world = makeGroup({ id: 'g-world', kind: 'world', order: 0 })
    const preset = makePreset(
      [world],
      [
        makeEntry({
          id: 'wi-before',
          groupId: 'g-world',
          content: '',
          bindingSlot: 'boundWorldBefore',
          order: 0,
        }),
        makeEntry({
          id: 'wi-after',
          groupId: 'g-world',
          content: '',
          bindingSlot: 'boundWorldAfter',
          order: 1,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, { world: 'LORE-XML' })
    const loreHits = messages.filter((m) => m.content.includes('LORE-XML'))
    assert.equal(loreHits.length, 1)
  })

  it('does not duplicate chat history when post history appears before chat history slot', () => {
    const history = makeGroup({ id: 'g-history', kind: 'history', order: 0 })
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
        makeEntry({
          id: 'bound-hist',
          groupId: 'g-history',
          content: '',
          bindingSlot: 'boundChatHistory',
          order: 1,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      history: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
      ],
      characterPostHistory: 'post',
    })
    assert.deepEqual(
      messages.map((m) => m.content),
      [
        'u1',
        'a1',
        '<char name="角色" attribute="post_history_instructions">post</char>',
      ],
    )
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

  it('anchors chat depth to last user message, not the full prompt tail', () => {
    const pre = makeGroup({ id: 'g-pre', kind: 'normal', order: 0 })
    const history = makeGroup({ id: 'g-history', kind: 'history', order: 1 })
    const ui = makeGroup({ id: 'g-ui', kind: 'userInput', order: 2 })
    const post = makeGroup({ id: 'g-post', kind: 'normal', order: 3 })
    const preset = makePreset(
      [pre, history, ui, post],
      [
        makeEntry({
          id: 'system-top',
          groupId: 'g-pre',
          content: 'SYSTEM-TOP',
          order: 0,
        }),
        makeEntry({
          id: 'bound-hist',
          groupId: 'g-history',
          content: '',
          bindingSlot: 'boundChatHistory',
          order: 0,
        }),
        makeEntry({
          id: 'bound-ui',
          groupId: 'g-ui',
          content: '',
          bindingSlot: 'boundUserInput',
          order: 0,
        }),
        makeEntry({
          id: 'chat-inject',
          groupId: 'g-post',
          content: 'CHAT-INJECT-DEPTH-4',
          injectionPosition: 'chat',
          injectionDepth: 4,
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      history: [
        { role: 'user', content: 'u-old-1' },
        { role: 'assistant', content: 'a-old-1' },
        { role: 'user', content: 'u-old-2' },
        { role: 'assistant', content: 'a-old-2' },
      ],
      userInput: 'u-current',
    })
    const contents = messages.map((m) => m.content)
    assert.ok(contents.includes('SYSTEM-TOP'))
    assert.ok(contents.includes('CHAT-INJECT-DEPTH-4'))
    assert.equal(
      contents.indexOf('CHAT-INJECT-DEPTH-4') < contents.indexOf('SYSTEM-TOP'),
      false,
    )
    assert.ok(
      contents.indexOf('u-old-1') <
        contents.indexOf('CHAT-INJECT-DEPTH-4'),
    )
    assert.ok(
      contents.indexOf('CHAT-INJECT-DEPTH-4') <
        contents.indexOf('a-old-1'),
    )
    assert.ok(
      contents.indexOf('a-old-2') <
        contents.indexOf('u-current'),
    )
    assert.ok(
      contents.indexOf('CHAT-INJECT-DEPTH-4') <
        contents.indexOf('u-current'),
    )
  })
})

describe('assemblePrompts afterUserInput', () => {
  it('injects immediately after last user message, before depth-0 chat entries', () => {
    const ui = makeGroup({ id: 'g-ui', kind: 'userInput', order: 0 })
    const post = makeGroup({ id: 'g-post', kind: 'normal', order: 1 })
    const preset = makePreset(
      [ui, post],
      [
        makeEntry({
          id: 'bound-ui',
          groupId: 'g-ui',
          content: '',
          bindingSlot: 'boundUserInput',
          order: 0,
        }),
        makeEntry({
          id: 'chat-depth-0',
          groupId: 'g-post',
          content: 'CHAT-DEPTH-0',
          injectionPosition: 'chat',
          injectionDepth: 0,
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      userInput: 'turn',
      afterUserInput: { content: 'GROUP-CHAT-RULE', role: 'system' },
    })
    const tail = messages.slice(-3).map((m) => m.content)
    assert.deepEqual(tail, ['turn', 'GROUP-CHAT-RULE', 'CHAT-DEPTH-0'])
  })

  it('does not merge into authorsNote depth', () => {
    const ui = makeGroup({ id: 'g-ui', kind: 'userInput', order: 0 })
    const preset = makePreset(
      [ui],
      [
        makeEntry({
          id: 'bound-ui',
          groupId: 'g-ui',
          content: '',
          bindingSlot: 'boundUserInput',
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      userInput: 'turn',
      afterUserInput: { content: 'GROUP-CHAT-RULE', role: 'system' },
      authorsNote: {
        content: 'AUTHORS-NOTE',
        injectionDepth: 4,
        role: 'system',
      },
    })
    const groupIdx = messages.findIndex((m) => m.content === 'GROUP-CHAT-RULE')
    const noteIdx = messages.findIndex((m) => m.content === 'AUTHORS-NOTE')
    const userIdx = messages.findIndex((m) => m.content === 'turn')
    assert.ok(groupIdx > userIdx)
    assert.ok(noteIdx < userIdx)
    assert.notEqual(groupIdx, noteIdx)
  })
})

describe('resolveChatDepthInsertIndex', () => {
  const stack: ChatMessage[] = [
    { role: 'system', content: 'top' },
    { role: 'user', content: 'u1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'u2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'u-current' },
  ]

  it('depth 0 inserts after the last user message', () => {
    assert.equal(resolveChatDepthInsertIndex(stack, 0), 6)
  })

  it('depth 4 inserts before the fourth message counting back from last user', () => {
    assert.equal(resolveChatDepthInsertIndex(stack, 4, 1), 2)
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
      [
        'before-char',
        '<char name="角色" attribute="system_prompt">CHAR-SP</char>',
        'CHAR',
        'between',
        '<user name="用户" attribute="system_prompt">USER-SP</user>\n\nUSER',
        'after-user',
      ],
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

describe('assemblePrompts bindingPlaceholderMode', () => {
  it('emits inject tags instead of sample character/world/history content', () => {
    const char = makeGroup({ id: 'g-char', kind: 'character', order: 1 })
    const world = makeGroup({ id: 'g-world', kind: 'world', order: 2 })
    const hist = makeGroup({ id: 'g-hist', kind: 'history', order: 3 })
    const preset = makePreset(
      [char, world, hist],
      [
        makeEntry({
          id: 'persona',
          groupId: 'g-char',
          content: '',
          bindingSlot: 'boundUserPersona',
          order: 0,
        }),
        makeEntry({
          id: 'sys',
          groupId: 'g-char',
          content: '',
          bindingSlot: 'boundCharSystemPrompt',
          order: 1,
        }),
        makeEntry({
          id: 'desc',
          groupId: 'g-char',
          content: '',
          bindingSlot: 'boundCharDescription',
          order: 2,
        }),
        makeEntry({
          id: 'world',
          groupId: 'g-world',
          content: '',
          bindingSlot: 'boundWorldBefore',
          order: 0,
        }),
        makeEntry({
          id: 'mem',
          groupId: 'g-world',
          content: '',
          bindingSlot: 'boundMemory',
          order: 1,
        }),
        makeEntry({
          id: 'chat',
          groupId: 'g-hist',
          content: '',
          bindingSlot: 'boundChatHistory',
          order: 0,
        }),
        makeEntry({
          id: 'post',
          groupId: 'g-hist',
          content: '',
          bindingSlot: 'boundCharacterPostHistory',
          order: 1,
        }),
      ],
    )
    const sampleCard = '<char name="moka">\n  <description>Sample</description>\n</char>'
    const { messages } = assemblePrompts(preset, {
      bindingPlaceholderMode: true,
      characters: [
        {
          name: 'moka',
          cardBody: sampleCard,
          systemPrompt: 'Sample system_prompt',
          postHistory: 'Sample post_history',
        },
      ],
      world: '<lore>castle</lore>',
      memoryText: '<memory>turn summary</memory>',
      history: [{ role: 'user', content: 'hello' }],
    })
    const contents = messages.map((m) => m.content)
    assert.equal(
      contents.includes('<inject slot="user_persona" />'),
      true,
    )
    assert.equal(
      contents.includes('<inject slot="bound_character.system_prompt" />'),
      true,
    )
    assert.equal(
      contents.includes('<inject slot="bound_character.description" />'),
      true,
    )
    assert.equal(contents.includes('<inject slot="lorebook" />'), true)
    assert.equal(contents.includes('<inject slot="memory" />'), true)
    assert.equal(contents.includes('<inject slot="chat_history" />'), true)
    assert.equal(
      contents.includes(
        '<inject slot="bound_character.post_history_instructions" />',
      ),
      true,
    )
    assert.equal(contents.some((c) => c.includes('Sample system_prompt')), false)
    assert.equal(contents.some((c) => c.includes('Sample post_history')), false)
    assert.equal(contents.some((c) => c.includes('castle')), false)
    assert.equal(contents.some((c) => c.includes('turn summary')), false)
    assert.equal(contents.some((c) => c.includes('hello')), false)
  })

  it('wraps granular character binding slots in char field xml', () => {
    const character = makeGroup({ id: 'g-char', kind: 'character', order: 0 })
    const preset = makePreset(
      [character],
      [
        makeEntry({
          id: 'desc',
          groupId: 'g-char',
          content: '',
          bindingSlot: 'boundCharDescription',
          order: 0,
        }),
        makeEntry({
          id: 'pers',
          groupId: 'g-char',
          content: '',
          bindingSlot: 'boundCharPersonality',
          order: 1,
        }),
      ],
    )
    const card = {
      name: 'moka',
      description: 'Brave cat',
      personality: 'Curious',
    }
    const { messages } = assemblePrompts(preset, {
      characters: [
        {
          name: 'moka',
          macroFields: extractMacroCharacterFields(card),
        },
      ],
    })
    assert.deepEqual(messages.map((m) => m.content), [
      '<char name="moka" attribute="description">Brave cat</char>',
      '<char name="moka" attribute="personality">Curious</char>',
    ])
  })
})
