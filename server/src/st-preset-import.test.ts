import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assemblePrompts } from './assemble-prompts.js'
import { convertStPresetToArousalPub } from './st-preset-import.js'

const ST_FIXTURE = {
  name: 'Mini ST',
  prompts: [
    {
      identifier: 'main',
      name: 'Main',
      marker: true,
      content: '',
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
      identifier: 'charDescription',
      name: 'Char desc',
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
        { identifier: 'charDescription', enabled: true },
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
  it('maps markers, sections, and chat depth to arousalPub groups', () => {
    const preset = convertStPresetToArousalPub(ST_FIXTURE, {
      presetId: 'preset-mini',
    })

    assert.equal(preset.groups.length, 6)
    assert.ok(
      preset.prompts.some(
        (p) =>
          p.bindingSlot === 'boundCharacterSystem' &&
          p.groupId === 'group-character',
      ),
    )
    assert.ok(
      preset.prompts.some(
        (p) =>
          p.bindingSlot === 'boundUserPersona' &&
          p.groupId === 'group-character',
      ),
    )
    assert.ok(
      preset.prompts.some(
        (p) => p.bindingSlot === 'boundWorld' && p.groupId === 'group-world',
      ),
    )
    assert.ok(
      preset.prompts.some(
        (p) =>
          p.bindingSlot === 'boundCharacterPostHistory' &&
          p.groupId === 'group-history',
      ),
    )
    assert.ok(
      preset.prompts.some(
        (p) =>
          p.bindingSlot === 'boundUserInput' &&
          p.groupId === 'group-user-input',
      ),
    )

    const pre = preset.prompts.find((p) => p.title === 'Pre block')
    assert.equal(pre?.groupId, 'group-pre')
    assert.equal(pre?.injectionPosition, 'relative')

    const chatTail = preset.prompts.find((p) => p.title === 'Chat tail')
    assert.equal(chatTail?.groupId, 'group-post')
    assert.equal(chatTail?.injectionPosition, 'chat')

    const { messages } = assemblePrompts(preset, {
      characters: [{ cardBody: 'CARD', systemPrompt: 'CHAR-SP' }],
      userCharacter: { cardBody: 'USER' },
      characterPostHistory: 'POST',
      world: 'LORE',
      history: [{ role: 'user', content: 'u' }],
      userInput: 'now',
    })
    const contents = messages.map((m) => m.content)
    assert.ok(contents.includes('PRE'))
    assert.ok(contents.includes('CHAR-SP'))
    assert.ok(contents.includes('CARD'))
    assert.ok(contents.includes('USER'))
    assert.ok(contents.includes('CHAR-REL'))
    assert.ok(contents.some((c) => c.includes('LORE')))
    assert.ok(contents.includes('HIST-BEFORE'))
    assert.ok(contents.includes('u'))
    assert.ok(contents.includes('POST'))
    assert.ok(contents.includes('CHAT-TAIL'))
    assert.ok(contents.includes('now'))
    assert.equal(contents.indexOf('HIST-BEFORE'), contents.indexOf('u') - 1)
    assert.equal(contents.indexOf('CHAT-TAIL'), contents.indexOf('now') + 1)
    assert.ok(contents.indexOf('CHAR-SP') < contents.indexOf('CARD'))
    assert.ok(contents.indexOf('CARD') < contents.indexOf('CHAR-REL'))
    assert.ok(contents.indexOf('CHAR-REL') < contents.indexOf('USER'))
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
      characters: [{ cardBody: 'CARD', systemPrompt: 'CHAR-SP' }],
      world: 'LORE',
      history: [{ role: 'user', content: 'u' }],
      userInput: 'now',
    })
    const contents = messages.map((m) => m.content)
    assert.ok(!contents.includes('PRE'))
    assert.ok(!contents.includes('OFF'))
  })
})
