import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MacroCharacterFields } from './prompt-macros/index.js'
import { assemblePrompts } from './assemble-prompts.js'
import { convertStPresetToArousalPub } from './st-preset-import.js'

const SAMPLE_FIELDS: MacroCharacterFields = {
  description: 'DESC',
  personality: 'PERS',
  scenario: 'SCEN',
  firstMes: '',
  mesExample: 'MES-EX',
  creatorNotes: '',
  characterVersion: '2.0',
  systemPrompt: 'CHAR-SP',
  postHistoryInstructions: 'POST',
  alternateGreetings: [],
  depthPrompt: '',
}

const ST_FIXTURE = {
  name: 'Mini ST',
  prompts: [
    {
      identifier: 'main',
      name: 'Main',
      content: 'MAIN-TEXT',
    },
    {
      identifier: 'pre-custom',
      name: 'Pre block',
      role: 'system',
      content: 'PRE',
      injection_position: 0,
      injection_depth: 0,
      injection_order: 100,
    },
    {
      identifier: 'personaDescription',
      name: 'Persona',
      marker: true,
      content: '',
    },
    {
      identifier: 'charDescription',
      name: 'Char desc',
      marker: true,
      content: '',
    },
    {
      identifier: 'charPersonality',
      name: 'Char pers',
      marker: true,
      content: '',
    },
    {
      identifier: 'scenario',
      name: 'Scenario',
      marker: true,
      content: '',
    },
    {
      identifier: 'char-custom',
      name: 'Char relative',
      role: 'system',
      content: 'CHAR-REL',
      injection_position: 0,
      injection_depth: 2,
      injection_order: 100,
    },
    {
      identifier: 'worldInfoBefore',
      name: 'WI before',
      marker: true,
      content: '',
    },
    {
      identifier: 'chatHistory',
      name: 'Chat history',
      marker: true,
      content: '',
    },
    {
      identifier: 'hist-custom',
      name: 'Hist before',
      role: 'system',
      content: 'HIST-BEFORE',
      injection_position: 0,
      injection_depth: 1,
      injection_order: 100,
    },
    {
      identifier: 'jailbreak',
      name: 'Jailbreak',
      marker: true,
      content: '',
    },
    {
      identifier: 'chat-tail',
      name: 'Chat tail',
      role: 'system',
      content: 'CHAT-TAIL',
      injection_position: 1,
      injection_depth: 0,
      injection_order: 100,
    },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'pre-custom', enabled: true },
        { identifier: 'personaDescription', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'charPersonality', enabled: true },
        { identifier: 'scenario', enabled: true },
        { identifier: 'char-custom', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'hist-custom', enabled: true },
        { identifier: 'jailbreak', enabled: true },
        { identifier: 'chat-tail', enabled: true },
      ],
    },
  ],
} as const

describe('convertStPresetToArousalPub', () => {
  it('maps ST sub-blocks, sections, and chat depth to arousalPub groups', () => {
    const preset = convertStPresetToArousalPub(ST_FIXTURE, {
      presetId: 'preset-mini',
    })

    assert.ok(
      preset.prompts.some((p) => p.bindingSlot === 'boundMain'),
    )
    assert.ok(
      preset.prompts.some((p) => p.bindingSlot === 'boundCharDescription'),
    )
    assert.ok(
      preset.prompts.some((p) => p.bindingSlot === 'boundCharPersonality'),
    )
    assert.ok(
      preset.prompts.some((p) => p.bindingSlot === 'boundScenario'),
    )
    assert.ok(
      preset.prompts.some(
        (p) =>
          p.bindingSlot === 'boundUserPersona' &&
          p.groupId === 'group-character',
      ),
    )
    assert.ok(
      preset.prompts.some((p) => p.bindingSlot === 'boundWorldBefore'),
    )
    assert.ok(
      preset.prompts.some((p) => p.bindingSlot === 'boundChatHistory'),
    )
    assert.ok(
      preset.prompts.some(
        (p) => p.bindingSlot === 'boundCharacterPostHistory',
      ),
    )
    assert.ok(
      preset.prompts.some(
        (p) =>
          p.bindingSlot === 'boundUserInput' &&
          p.groupId === 'group-user-input',
      ),
    )

    const charBindings = preset.prompts
      .filter((p) => p.groupId === 'group-character' && p.bindingSlot)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.bindingSlot)
    assert.deepEqual(charBindings, [
      'boundUserPersona',
      'boundCharSystemPrompt',
      'boundCharDescription',
      'boundCharPersonality',
      'boundScenario',
    ])

    const histBindings = preset.prompts
      .filter((p) => p.groupId === 'group-history' && p.bindingSlot)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.bindingSlot)
    assert.deepEqual(histBindings, [
      'boundChatHistory',
      'boundCharacterPostHistory',
    ])
    const histOrdered = preset.prompts
      .filter((p) => p.groupId === 'group-history')
      .sort((a, b) => a.order - b.order)
      .map((p) => p.bindingSlot ?? p.title)
    assert.deepEqual(histOrdered, [
      'boundChatHistory',
      'Hist before',
      'boundCharacterPostHistory',
    ])

    const pre = preset.prompts.find((p) => p.title === 'Pre block')
    assert.equal(pre?.groupId, 'group-pre')

    const chatTail = preset.prompts.find((p) => p.title === 'Chat tail')
    assert.equal(chatTail?.groupId, 'group-post')
    assert.equal(chatTail?.injectionPosition, 'chat')

    const mainSlot = preset.prompts.find((p) => p.bindingSlot === 'boundMain')
    assert.equal(mainSlot?.content, 'MAIN-TEXT')

    const { messages } = assemblePrompts(preset, {
      characters: [
        { cardBody: 'CARD', macroFields: SAMPLE_FIELDS, postHistory: 'POST' },
      ],
      userCharacter: { cardBody: 'USER' },
      world: 'LORE',
      history: [{ role: 'user', content: 'u' }],
      userInput: 'now',
    })
    const contents = messages.map((m) => m.content)
    assert.ok(contents.includes('MAIN-TEXT'))
    assert.ok(contents.includes('PRE'))
    assert.ok(contents.includes('USER'))
    assert.ok(contents.includes('DESC'))
    assert.ok(contents.includes('PERS'))
    assert.ok(contents.includes('SCEN'))
    assert.ok(contents.includes('CHAR-REL'))
    assert.ok(contents.some((c) => c.includes('LORE')))
    assert.ok(contents.includes('HIST-BEFORE'))
    assert.ok(contents.includes('u'))
    assert.ok(contents.includes('POST'))
    assert.ok(contents.includes('CHAT-TAIL'))
    assert.ok(contents.includes('now'))
    assert.ok(contents.indexOf('DESC') < contents.indexOf('PERS'))
    assert.ok(contents.indexOf('PERS') < contents.indexOf('SCEN'))
    assert.ok(contents.indexOf('SCEN') < contents.indexOf('CHAR-REL'))
    assert.ok(contents.indexOf('USER') < contents.indexOf('DESC'))
  })

  it('imports disabled order items with enabled: false', () => {
    const preset = convertStPresetToArousalPub(
      {
        ...ST_FIXTURE,
        prompts: [
          ...ST_FIXTURE.prompts,
          {
            identifier: 'off-block',
            name: 'Off block',
            role: 'system',
            content: 'OFF',
            injection_position: 0,
          },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'main', enabled: true },
              { identifier: 'pre-custom', enabled: false },
              { identifier: 'off-block', enabled: false },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'worldInfoBefore', enabled: true },
              { identifier: 'chatHistory', enabled: true },
              { identifier: 'jailbreak', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-off' },
    )

    const pre = preset.prompts.find((p) => p.title === 'Pre block')
    const off = preset.prompts.find((p) => p.title === 'Off block')
    assert.equal(pre?.enabled, false)
    assert.equal(off?.enabled, false)

    const { messages } = assemblePrompts(preset, {
      characters: [{ cardBody: 'CARD', macroFields: SAMPLE_FIELDS }],
      world: 'LORE',
      history: [{ role: 'user', content: 'u' }],
      userInput: 'now',
    })
    const contents = messages.map((m) => m.content)
    assert.ok(!contents.includes('PRE'))
    assert.ok(!contents.includes('OFF'))
  })

  it('keeps history bindings at chatHistory and jailbreak positions in source order', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST history order',
        prompts: [
          {
            identifier: 'chatHistory',
            name: 'Chat history',
            marker: true,
            content: '',
          },
          {
            identifier: 'hist-mid',
            name: 'Mid hist',
            role: 'system',
            content: 'MID',
          },
          {
            identifier: 'jailbreak',
            name: 'Jailbreak',
            marker: true,
            content: '',
          },
          {
            identifier: 'hist-after',
            name: 'After hist',
            role: 'system',
            content: 'AFTER',
          },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'chatHistory', enabled: true },
              { identifier: 'hist-mid', enabled: true },
              { identifier: 'jailbreak', enabled: true },
              { identifier: 'hist-after', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-hist-order' },
    )

    const histOrdered = preset.prompts
      .filter((p) => p.groupId === 'group-history')
      .sort((a, b) => a.order - b.order)
      .map((p) => p.bindingSlot ?? p.title)
    assert.deepEqual(histOrdered, [
      'boundChatHistory',
      'Mid hist',
      'boundCharacterPostHistory',
    ])
    const postCustom = preset.prompts.find((p) => p.title === 'After hist')
    assert.equal(postCustom?.groupId, 'group-post')
  })

  it('places char core bundle at charDescription position in source prompt_order (scenario before desc)', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST stabs-like',
        prompts: [
          { identifier: 'personaDescription', name: 'Persona', marker: true, content: '' },
          {
            identifier: 'after-persona',
            name: 'After persona',
            role: 'system',
            content: 'USER-TAIL',
          },
          { identifier: 'scenario', name: 'Scenario', marker: true, content: '' },
          { identifier: 'charDescription', name: 'Char desc', marker: true, content: '' },
          { identifier: 'charPersonality', name: 'Char pers', marker: true, content: '' },
          { identifier: 'chatHistory', name: 'Hist', marker: true, content: '' },
          { identifier: 'jailbreak', name: 'JB', marker: true, content: '' },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'personaDescription', enabled: true },
              { identifier: 'after-persona', enabled: true },
              { identifier: 'scenario', enabled: true },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'charPersonality', enabled: true },
              { identifier: 'chatHistory', enabled: true },
              { identifier: 'jailbreak', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-stabs-like' },
    )

    const charOrdered = preset.prompts
      .filter((p) => p.groupId === 'group-character')
      .sort((a, b) => a.order - b.order)
      .map((p) => p.bindingSlot ?? p.title)
    assert.deepEqual(charOrdered, [
      'boundUserPersona',
      'After persona',
      'boundScenario',
      'boundCharSystemPrompt',
      'boundCharDescription',
      'boundCharPersonality',
    ])

    const charBindings = preset.prompts
      .filter((p) => p.groupId === 'group-character' && p.bindingSlot)
      .sort((a, b) => a.order - b.order)
      .map((p) => p.bindingSlot)
    assert.deepEqual(charBindings, [
      'boundUserPersona',
      'boundScenario',
      'boundCharSystemPrompt',
      'boundCharDescription',
      'boundCharPersonality',
    ])
  })

  it('anchors character group at first role-card marker, not personaDescription', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST persona before char anchors',
        prompts: [
          { identifier: 'worldInfoBefore', name: 'WI', marker: true, content: '' },
          { identifier: 'personaDescription', name: 'Persona', marker: true, content: '' },
          { identifier: 'scenario', name: 'Scenario', marker: true, content: '' },
          { identifier: 'charDescription', name: 'Char', marker: true, content: '' },
          { identifier: 'chatHistory', name: 'Hist', marker: true, content: '' },
          { identifier: 'jailbreak', name: 'JB', marker: true, content: '' },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'worldInfoBefore', enabled: true },
              { identifier: 'personaDescription', enabled: true },
              { identifier: 'scenario', enabled: true },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'chatHistory', enabled: true },
              { identifier: 'jailbreak', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-persona-user-block' },
    )

    const worldOrder = preset.groups.find((g) => g.id === 'group-world')?.order
    const charOrder = preset.groups.find((g) => g.id === 'group-character')?.order
    assert.ok(worldOrder != null && charOrder != null)
    assert.ok(worldOrder < charOrder)
  })

  it('places world-before-persona customs in gap group and orders world before character', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST gap',
        prompts: [
          { identifier: 'worldInfoBefore', name: 'WI', marker: true, content: '' },
          { identifier: 'between', name: 'Between', role: 'system', content: 'GAP' },
          { identifier: 'personaDescription', name: 'Persona', marker: true, content: '' },
          { identifier: 'charDescription', name: 'Char', marker: true, content: '' },
          { identifier: 'chatHistory', name: 'Hist', marker: true, content: '' },
          { identifier: 'jailbreak', name: 'JB', marker: true, content: '' },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'worldInfoBefore', enabled: true },
              { identifier: 'between', enabled: true },
              { identifier: 'personaDescription', enabled: true },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'chatHistory', enabled: true },
              { identifier: 'jailbreak', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-gap', presetName: 'Gap test' },
    )

    assert.equal(preset.name, 'Gap test')
    const gap = preset.prompts.find((p) => p.title === 'Between')
    assert.equal(gap?.groupId, 'group-st-gap-world-persona')
    const worldOrder = preset.groups.find((g) => g.id === 'group-world')?.order
    const charOrder = preset.groups.find((g) => g.id === 'group-character')?.order
    assert.ok(worldOrder != null && charOrder != null)
    assert.ok(worldOrder < charOrder)
  })

  it('throws when prompt_order is empty', () => {
    assert.throws(
      () =>
        convertStPresetToArousalPub({
          prompts: [{ identifier: 'main' }],
          prompt_order: [{ character_id: 100001, order: [] }],
        }),
      /prompt_order/,
    )
  })
})
