import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractMacroCharacterFields } from '../../src/prompt-macros/character-fields.js'
import { buildPromptMacroContext } from '../../src/prompt-macros/context.js'
import { applyPromptMacroPipeline } from '../../src/prompt-macros/pipeline.js'
import { MACRO_VAR_MAX_KEYS } from '../../src/prompt-macros/macro-var-limits.js'
import type { PromptMacroContext } from '../../src/prompt-macros/types.js'

const sampleCard = {
  name: '艾拉',
  description: '角色描述',
  personality: '温柔',
  scenario: '咖啡馆',
  first_mes: '你好呀',
  mes_example: '示例对话',
  creator_notes: '创作者备注',
  character_version: '3.1',
  system_prompt: '系统提示',
  post_history_instructions: '后置指令',
  alternate_greetings: ['备选问候'],
}

function ctx(
  overrides: Parameters<typeof buildPromptMacroContext>[0] &
    Partial<PromptMacroContext> = {},
) {
  return {
    ...buildPromptMacroContext({
      conversationUserName: '小明',
      characters: [
        { name: '艾拉', macroFields: extractMacroCharacterFields(sampleCard) },
        { name: '鲍勃' },
      ],
      model: 'gpt-test',
      contextLength: 8192,
      maxResponseTokens: 512,
      userInput: '用户输入文本',
      promptTrigger: 'continue',
      now: new Date('2026-06-10T15:04:05Z'),
      authorsNote: '作者注正文',
      ...overrides,
    }),
    ...overrides,
  }
}

describe('applyPromptMacroPipeline (CST)', () => {
  it('expands known macros', () => {
    const out = applyPromptMacroPipeline(
      '{{user}}|{{char}}|{{char2}}|{{model}}|{{context}}|{{newline}}X|{{authorsNote}}',
      ctx(),
    )
    assert.equal(
      out,
      '小明|艾拉|鲍勃|gpt-test|8192|\nX|作者注正文',
    )
  })

  it('is case-insensitive for known macro names', () => {
    const out = applyPromptMacroPipeline('{{USER}} {{Char1}}', ctx())
    assert.equal(out, '小明 艾拉')
  })

  it('supports {{charN}} legacy form', () => {
    assert.equal(
      applyPromptMacroPipeline('{{char2}}', ctx()),
      '鲍勃',
    )
  })

  it('marks unknown macros as [name UNSUPPORTED]', () => {
    assert.equal(
      applyPromptMacroPipeline('{{unknownMacro}}', ctx()),
      '[unknownMacro UNSUPPORTED]',
    )
  })

  it('marks unclosed macros as [UNSUPPORTED]', () => {
    assert.equal(applyPromptMacroPipeline('{{user', ctx()), '[UNSUPPORTED]')
  })

  it('defaults user/char when missing', () => {
    const empty = ctx({
      conversationUserName: '',
      characters: [],
    })
    assert.equal(applyPromptMacroPipeline('{{user}}/{{char}}', empty), '用户/角色')
  })

  it('char index out of range yields empty (except char1 default)', () => {
    assert.equal(applyPromptMacroPipeline('{{char 9}}', ctx()), '')
  })

  it('skips pipeline when no mustache', () => {
    assert.equal(applyPromptMacroPipeline('plain text', ctx()), 'plain text')
  })
})

describe('Phase A macros', () => {
  it('expands character card field macros', () => {
    const out = applyPromptMacroPipeline(
      '{{description}}|{{personality}}|{{scenario}}|{{charPrompt}}|{{charInstruction}}|{{mesExamples}}|{{charCreatorNotes}}|{{charVersion}}',
      ctx(),
    )
    assert.equal(
      out,
      '角色描述|温柔|咖啡馆|系统提示|后置指令|示例对话|创作者备注|3.1',
    )
  })

  it('expands charFirstMessage and alternate greeting index', () => {
    assert.equal(
      applyPromptMacroPipeline('{{charFirstMessage}} / {{charFirstMessage::1}}', ctx()),
      '你好呀 / 备选问候',
    )
  })

  it('expands assemble context macros', () => {
    const out = applyPromptMacroPipeline(
      '{{input}}|{{lastGenerationType}}|{{maxResponseTokens}}',
      ctx(),
    )
    assert.equal(out, '用户输入文本|continue|512')
  })

  it('expands date extensions and datetimeformat', () => {
    const out = applyPromptMacroPipeline(
      '{{weekday}}|{{isodate}}|{{isotime}}|{{datetimeformat::YYYY-MM-DD}}',
      ctx(),
    )
    assert.match(out, /\|2026-06-10\|/)
    assert.match(out, /\|2026-06-10$/)
  })

  it('expands utility macros', () => {
    assert.equal(applyPromptMacroPipeline('{{space::3}}X', ctx()), '   X')
    assert.equal(applyPromptMacroPipeline('{{newline::2}}Y', ctx()), '\n\nY')
    assert.equal(applyPromptMacroPipeline('{{noop}}Z', ctx()), 'Z')
    assert.equal(applyPromptMacroPipeline('{{trim::  ab  }}', ctx()), 'ab')
    assert.equal(applyPromptMacroPipeline('{{reverse::abc}}', ctx()), 'cba')
    assert.equal(applyPromptMacroPipeline('{{random::a::b::c}}', ctx()).length, 1)
    assert.match(applyPromptMacroPipeline('{{roll::1d6}}', ctx()), /^[1-6]$/)
  })

  it('does not expand legacy angle tags', () => {
    assert.equal(
      applyPromptMacroPipeline('<USER> says hi to <CHAR>', ctx()),
      '<USER> says hi to <CHAR>',
    )
  })

  it('supports camelCase ST macro names', () => {
    assert.equal(
      applyPromptMacroPipeline('{{mesExamplesRaw}} {{charPrompt}}', ctx()),
      '示例对话 系统提示',
    )
  })

  it('expands {{defaultAuthorsNote}} separately from {{authorsNote}}', () => {
    const out = applyPromptMacroPipeline(
      '{{authorsNote}}|{{defaultAuthorsNote}}',
      ctx({ defaultAuthorsNote: '全局默认模板' }),
    )
    assert.equal(out, '作者注正文|全局默认模板')
  })
})

describe('Phase B macros', () => {
  it('expands history tail and pick macros', () => {
    const out = applyPromptMacroPipeline(
      '{{lastCharMessage}}|{{lastMessageId}}|{{pick::A::B}}',
      ctx({
        conversationId: 'conv-test',
        lastCharMessage: '助手尾句',
        lastMessageId: '5',
        allChatRange: '0-5',
      }),
    )
    assert.equal(out.startsWith('助手尾句|5|'), true)
    assert.match(out, /\|A$|\|B$/)
  })

  it('expands hasExtension from enabledPluginIds', () => {
    const out = applyPromptMacroPipeline('{{hasExtension::fixture-plugin-a}}', ctx({
      enabledPluginIds: ['fixture-plugin-a'],
    }))
    assert.equal(out, 'true')
  })

  it('expands idleDuration and timeDiff', () => {
    const now = new Date('2023-06-01T14:00:00.000Z')
    const idle = applyPromptMacroPipeline('{{idleDuration}}', ctx({
      now,
      locale: 'en',
      idleReferenceUserAt: '2023-06-01T12:00:00.000Z',
    }))
    assert.match(idle, /hour/i)

    const diff = applyPromptMacroPipeline(
      '{{timeDiff::2023-06-01T15:00:00.000Z::2023-06-01T12:00:00.000Z}}',
      ctx({ now, locale: 'en' }),
    )
    assert.match(diff, /hour/i)
  })
})

describe('Phase C macros', () => {
  it('expands ST {{if}} / {{else}} blocks', () => {
    assert.equal(
      applyPromptMacroPipeline('{{if user}}yes{{/if}}', ctx()),
      'yes',
    )
    assert.equal(
      applyPromptMacroPipeline('{{if description}}D{{else}}E{{/if}}', ctx()),
      'D',
    )
    assert.equal(
      applyPromptMacroPipeline('{{if !description}}X{{/if}}', ctx()),
      '',
    )
  })

  it('supports getvar/setvar and shorthands', () => {
    const c = ctx()
    assert.equal(
      applyPromptMacroPipeline('{{setvar::k::v}}{{getvar::k}}', c),
      'v',
    )
    assert.equal(c.macroVarsDirty, true)
    assert.equal(c.macroLocalVars?.k, 'v')

    const c2 = ctx({ macroLocalVars: { mood: 'happy' } })
    assert.equal(applyPromptMacroPipeline('{{.mood}}', c2), 'happy')
  })

  it('supports global vars and hasvar', () => {
    const c = ctx({ macroGlobalVars: { theme: 'dark' } })
    assert.equal(applyPromptMacroPipeline('{{$theme}}', c), 'dark')
    assert.equal(
      applyPromptMacroPipeline('{{hasvar::missing}}|{{hasglobalvar::theme}}', c),
      'false|true',
    )
  })

  it('strips comments and restores escaped braces', () => {
    assert.equal(
      applyPromptMacroPipeline('a{{// note}}b', ctx()),
      'ab',
    )
    assert.equal(
      applyPromptMacroPipeline('\\{\\{user\\}\\}', ctx()),
      '{{user}}',
    )
  })

  it('expands nested macros inside arguments', () => {
    const c = ctx()
    assert.equal(
      applyPromptMacroPipeline('{{setvar::tag::{{char}}}}{{getvar::tag}}', c),
      '艾拉',
    )
  })

  it('supports scoped setvar blocks', () => {
    const c = ctx()
    const out = applyPromptMacroPipeline(
      '{{setvar note}}line1\nline2{{/setvar}}{{getvar::note}}',
      c,
    )
    assert.equal(out, 'line1\nline2')
  })

  it('supports D2 addvar, comparison if, and no-arg trim', () => {
    const c = ctx({ macroLocalVars: { tier: 'a', effort: 'Low', t0: 'Tier:\n' } })
    applyPromptMacroPipeline('{{addvar::tier::b}}', c)
    assert.equal(c.macroLocalVars?.tier, 'ab')
    assert.equal(
      applyPromptMacroPipeline(
        '{{#if {{.effort != High}}}}ok{{/if}}',
        c,
      ),
      'ok',
    )
    applyPromptMacroPipeline('{{addvar::t0::- [ ] X\n}}', c)
    assert.equal(c.macroLocalVars?.t0, 'Tier:\n- [ ] X\n')
    const c2 = ctx({ macroLocalVars: { reasoningeffort: 'High' } })
    assert.equal(
      applyPromptMacroPipeline(
        '{{#if {{.reasoningeffort == High}}}}H{{/if}}',
        c2,
      ),
      'H',
    )
    assert.equal(
      applyPromptMacroPipeline('{{char}}   {{trim}}', ctx()),
      '艾拉',
    )
  })

  it('supports D2.5 shorthand operators', () => {
    const c = ctx({ macroLocalVars: { tier: 'a' } })
    applyPromptMacroPipeline('{{.tier = ab}}', c)
    assert.equal(c.macroLocalVars?.tier, 'ab')
    applyPromptMacroPipeline('{{.tier += c}}', c)
    assert.equal(c.macroLocalVars?.tier, 'abc')
    assert.equal(
      applyPromptMacroPipeline('{{.tier == abc}}', c),
      'true',
    )
    const c2 = ctx()
    applyPromptMacroPipeline('{{ .note = hello }}', c2)
    assert.equal(c2.macroLocalVars?.note, 'hello')
  })

  it('refuses new local vars beyond key cap', () => {
    const vars: Record<string, string> = {}
    for (let i = 0; i < MACRO_VAR_MAX_KEYS; i++) {
      vars[`k${i}`] = 'v'
    }
    const c = ctx({ macroLocalVars: vars })
    applyPromptMacroPipeline('{{setvar::overflow::x}}', c)
    assert.equal(c.macroLocalVars?.overflow, undefined)
    assert.equal(Object.keys(c.macroLocalVars ?? {}).length, MACRO_VAR_MAX_KEYS)
  })
})
