import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MacroCharacterFields } from './prompt-macros/index.js'
import { assemblePrompts } from './assemble-prompts.js'
import {
  convertStPresetToArousalPub,
  isLegacyStGapGroupId,
} from './st-preset-import.js'

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

function assertNoStGapGroups(
  preset: ReturnType<typeof convertStPresetToArousalPub>,
) {
  assert.ok(
    !preset.groups.some((g) => isLegacyStGapGroupId(g.id)),
    'must not create ST gap container groups',
  )
  assert.ok(
    !preset.prompts.some((p) => isLegacyStGapGroupId(p.groupId)),
    'must not place prompts in ST gap container groups',
  )
}

function assertGroupsOrdered(
  preset: ReturnType<typeof convertStPresetToArousalPub>,
  ...groupIds: string[]
) {
  const orders = groupIds.map((id) => {
    const g = preset.groups.find((x) => x.id === id)
    assert.ok(g, `missing group ${id}`)
    return g.order
  })
  for (let i = 1; i < orders.length; i++) {
    assert.ok(orders[i - 1]! < orders[i]!)
  }
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

    assertNoStGapGroups(preset)
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
      !preset.prompts.some(
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
    assert.deepEqual(histBindings, ['boundChatHistory'])
    const histOrdered = preset.prompts
      .filter((p) => p.groupId === 'group-history')
      .sort((a, b) => a.order - b.order)
      .map((p) => p.bindingSlot ?? p.title)
    assert.deepEqual(histOrdered, ['boundChatHistory', 'Hist before'])

    const preBlock = preset.prompts.find((p) => p.title === 'Pre block')
    assert.equal(preBlock?.groupId, 'group-pre')
    assertGroupsOrdered(preset, 'group-pre', 'group-character')

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
    assert.ok(!contents.includes('POST'))
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

  it('keeps relative customs in history group after chatHistory anchor', () => {
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
      'After hist',
    ])
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

  it('places world-before-persona customs in world group and orders world before character', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST gap',
        prompts: [
          { identifier: 'worldInfoBefore', name: 'WI', marker: true, content: '' },
          { identifier: 'between', name: 'Between', role: 'system', content: 'GAP' },
          { identifier: 'personaDescription', name: 'Persona', marker: true, content: '' },
          { identifier: 'charDescription', name: 'Char', marker: true, content: '' },
          { identifier: 'chatHistory', name: 'Hist', marker: true, content: '' },
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
            ],
          },
        ],
      },
      { presetId: 'preset-gap', presetName: 'Gap test' },
    )

    assert.equal(preset.name, 'Gap test')
    assertNoStGapGroups(preset)
    const between = preset.prompts.find((p) => p.title === 'Between')
    assert.equal(between?.groupId, 'group-world')
    assertGroupsOrdered(preset, 'group-world', 'group-character')

    const { messages } = assemblePrompts(preset, {
      characters: [
        { cardBody: 'CARD', macroFields: SAMPLE_FIELDS, postHistory: 'POST' },
      ],
      userCharacter: { cardBody: 'USER' },
      world: 'LORE',
      history: [{ role: 'user', content: 'u' }],
    })
    const contents = messages.map((m) => m.content)
    assert.ok(contents.some((c) => c.includes('LORE')))
    assert.ok(contents.includes('GAP'))
    assert.ok(contents.includes('USER'))
    assert.ok(contents.includes('u'))
    const loreIdx = contents.findIndex((c) => c.includes('LORE'))
    const gapIdx = contents.indexOf('GAP')
    const userIdx = contents.indexOf('USER')
    const histIdx = contents.indexOf('u')
    assert.ok(loreIdx < gapIdx)
    assert.ok(gapIdx < userIdx)
    assert.ok(userIdx < histIdx)
  })

  it('does not create extra groups when world and persona are adjacent', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST no gap',
        prompts: [
          { identifier: 'worldInfoBefore', name: 'WI', marker: true, content: '' },
          { identifier: 'worldInfoAfter', name: 'WI after', marker: true, content: '' },
          { identifier: 'personaDescription', name: 'Persona', marker: true, content: '' },
          { identifier: 'charDescription', name: 'Char', marker: true, content: '' },
          { identifier: 'chatHistory', name: 'Hist', marker: true, content: '' },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'worldInfoBefore', enabled: true },
              { identifier: 'worldInfoAfter', enabled: true },
              { identifier: 'personaDescription', enabled: true },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'chatHistory', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-no-gap' },
    )

    assertNoStGapGroups(preset)
  })

  it('places customs between main and worldInfoBefore in pre group', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST pre-world gap',
        prompts: [
          { identifier: 'main', name: 'Main', content: 'MAIN' },
          {
            identifier: 'pre-world-gap',
            name: 'Pre world gap',
            role: 'system',
            content: 'GAP',
          },
          { identifier: 'worldInfoBefore', name: 'WI', marker: true, content: '' },
          { identifier: 'personaDescription', name: 'Persona', marker: true, content: '' },
          { identifier: 'charDescription', name: 'Char', marker: true, content: '' },
          { identifier: 'chatHistory', name: 'Hist', marker: true, content: '' },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'main', enabled: true },
              { identifier: 'pre-world-gap', enabled: true },
              { identifier: 'worldInfoBefore', enabled: true },
              { identifier: 'personaDescription', enabled: true },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'chatHistory', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-pre-world-gap' },
    )

    const preWorldGap = preset.prompts.find((p) => p.title === 'Pre world gap')
    assert.equal(preWorldGap?.groupId, 'group-pre')
    assertGroupsOrdered(preset, 'group-pre', 'group-world')
  })

  it('places customs before chatHistory in character group', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST char-history gap',
        prompts: [
          { identifier: 'personaDescription', name: 'Persona', marker: true, content: '' },
          { identifier: 'charDescription', name: 'Char', marker: true, content: '' },
          {
            identifier: 'char-hist-gap',
            name: 'Char hist gap',
            role: 'system',
            content: 'GAP',
          },
          { identifier: 'chatHistory', name: 'Hist', marker: true, content: '' },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'personaDescription', enabled: true },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'char-hist-gap', enabled: true },
              { identifier: 'chatHistory', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-char-history-gap' },
    )

    assertNoStGapGroups(preset)
    const charHistGap = preset.prompts.find((p) => p.title === 'Char hist gap')
    assert.equal(charHistGap?.groupId, 'group-character')
    assertGroupsOrdered(preset, 'group-character', 'group-history')

    const { messages } = assemblePrompts(preset, {
      characters: [
        { cardBody: 'CARD', macroFields: SAMPLE_FIELDS, postHistory: 'POST' },
      ],
      userCharacter: { cardBody: 'USER' },
      history: [{ role: 'user', content: 'u' }],
    })
    const contents = messages.map((m) => m.content)
    assert.ok(contents.includes('GAP'))
    assert.ok(contents.includes('USER'))
    assert.ok(contents.includes('u'))
    const gapIdx = contents.indexOf('GAP')
    const userIdx = contents.indexOf('USER')
    const histIdx = contents.indexOf('u')
    assert.ok(userIdx < gapIdx)
    assert.ok(gapIdx < histIdx)
  })

  it('orders structural groups by source marker first appearance', () => {
    const preset = convertStPresetToArousalPub(
      {
        name: 'ST char before world',
        prompts: [
          { identifier: 'personaDescription', name: 'Persona', marker: true, content: '' },
          { identifier: 'charDescription', name: 'Char', marker: true, content: '' },
          { identifier: 'worldInfoBefore', name: 'WI', marker: true, content: '' },
          { identifier: 'chatHistory', name: 'Hist', marker: true, content: '' },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'personaDescription', enabled: true },
              { identifier: 'charDescription', enabled: true },
              { identifier: 'worldInfoBefore', enabled: true },
              { identifier: 'chatHistory', enabled: true },
            ],
          },
        ],
      },
      { presetId: 'preset-char-before-world' },
    )

    assertGroupsOrdered(
      preset,
      'group-character',
      'group-world',
      'group-history',
      'group-user-input',
      'group-post',
    )
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
