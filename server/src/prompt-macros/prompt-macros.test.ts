import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractMacroCharacterFields } from './character-fields.js'
import { buildPromptMacroContext } from './context.js'
import { clearMacroTemplateCache } from './handlebars-engine.js'
import { applyPromptMacroPipeline } from './pipeline.js'
import type { PromptMacroContext } from './types.js'

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

describe('applyPromptMacroPipeline (Handlebars)', () => {
  it('expands known macros', () => {
    clearMacroTemplateCache()
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
    clearMacroTemplateCache()
    const out = applyPromptMacroPipeline('{{USER}} {{Char1}}', ctx())
    assert.equal(out, '小明 艾拉')
  })

  it('supports {{charN}} legacy form', () => {
    clearMacroTemplateCache()
    assert.equal(
      applyPromptMacroPipeline('{{char2}}', ctx()),
      '鲍勃',
    )
  })

  it('marks unknown macros as [name UNSUPPORTED]', () => {
    clearMacroTemplateCache()
    assert.equal(
      applyPromptMacroPipeline('{{unknownMacro}}', ctx()),
      '[unknownMacro UNSUPPORTED]',
    )
  })

  it('marks compile/render failures as [name RENDERFAIL]', () => {
    clearMacroTemplateCache()
    assert.equal(
      applyPromptMacroPipeline('{{#stIf}}{{/stIf}}', ctx()),
      '[#stIf RENDERFAIL][/stIf RENDERFAIL]',
    )
  })

  it('defaults user/char when missing', () => {
    clearMacroTemplateCache()
    const empty = ctx({
      conversationUserName: '',
      characters: [],
    })
    assert.equal(applyPromptMacroPipeline('{{user}}/{{char}}', empty), '用户/角色')
  })

  it('char index out of range yields empty (except char1 default)', () => {
    clearMacroTemplateCache()
    assert.equal(applyPromptMacroPipeline('{{char 9}}', ctx()), '')
  })

  it('skips pipeline when no mustache', () => {
    assert.equal(applyPromptMacroPipeline('plain text', ctx()), 'plain text')
  })
})

describe('Phase A macros', () => {
  it('expands character card field macros', () => {
    clearMacroTemplateCache()
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
    clearMacroTemplateCache()
    assert.equal(
      applyPromptMacroPipeline('{{charFirstMessage}} / {{charFirstMessage::1}}', ctx()),
      '你好呀 / 备选问候',
    )
  })

  it('expands assemble context macros', () => {
    clearMacroTemplateCache()
    const out = applyPromptMacroPipeline(
      '{{input}}|{{lastGenerationType}}|{{maxResponseTokens}}',
      ctx(),
    )
    assert.equal(out, '用户输入文本|continue|512')
  })

  it('expands date extensions and datetimeformat', () => {
    clearMacroTemplateCache()
    const out = applyPromptMacroPipeline(
      '{{weekday}}|{{isodate}}|{{isotime}}|{{datetimeformat::YYYY-MM-DD}}',
      ctx(),
    )
    assert.match(out, /\|2026-06-10\|/)
    assert.match(out, /\|2026-06-10$/)
  })

  it('expands utility macros', () => {
    clearMacroTemplateCache()
    assert.equal(applyPromptMacroPipeline('{{space::3}}X', ctx()), '   X')
    assert.equal(applyPromptMacroPipeline('{{newline::2}}Y', ctx()), '\n\nY')
    assert.equal(applyPromptMacroPipeline('{{noop}}Z', ctx()), 'Z')
    assert.equal(applyPromptMacroPipeline('{{trim::  ab  }}', ctx()), 'ab')
    assert.equal(applyPromptMacroPipeline('{{reverse::abc}}', ctx()), 'cba')
    assert.equal(applyPromptMacroPipeline('{{random::a::b::c}}', ctx()).length, 1)
    assert.match(applyPromptMacroPipeline('{{roll::1d6}}', ctx()), /^[1-6]$/)
  })

  it('preprocesses legacy angle tags', () => {
    clearMacroTemplateCache()
    assert.equal(
      applyPromptMacroPipeline('<USER> says hi to <CHAR>', ctx()),
      '小明 says hi to 艾拉',
    )
  })

  it('supports camelCase ST macro names', () => {
    clearMacroTemplateCache()
    assert.equal(
      applyPromptMacroPipeline('{{mesExamplesRaw}} {{charPrompt}}', ctx()),
      '示例对话 系统提示',
    )
  })

  it('expands {{defaultAuthorsNote}} separately from {{authorsNote}}', () => {
    clearMacroTemplateCache()
    const out = applyPromptMacroPipeline(
      '{{authorsNote}}|{{defaultAuthorsNote}}',
      ctx({ defaultAuthorsNote: '全局默认模板' }),
    )
    assert.equal(out, '作者注正文|全局默认模板')
  })
})

describe('Phase B macros', () => {
  it('expands history tail and pick macros', () => {
    clearMacroTemplateCache()
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
    clearMacroTemplateCache()
    const out = applyPromptMacroPipeline('{{hasExtension::plot-summary}}', ctx({
      enabledPluginIds: ['plot-summary'],
    }))
    assert.equal(out, 'true')
  })

  it('expands idleDuration and timeDiff', () => {
    clearMacroTemplateCache()
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
    clearMacroTemplateCache()
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
    clearMacroTemplateCache()
    const c = ctx()
    assert.equal(
      applyPromptMacroPipeline('{{setvar::k::v}}{{getvar::k}}', c),
      'v',
    )
    assert.equal(c.macroVarsDirty, true)
    assert.equal(c.macroLocalVars?.k, 'v')

    clearMacroTemplateCache()
    const c2 = ctx({ macroLocalVars: { mood: 'happy' } })
    assert.equal(applyPromptMacroPipeline('{{.mood}}', c2), 'happy')
  })

  it('supports global vars and hasvar', () => {
    clearMacroTemplateCache()
    const c = ctx({ macroGlobalVars: { theme: 'dark' } })
    assert.equal(applyPromptMacroPipeline('{{$theme}}', c), 'dark')
    assert.equal(
      applyPromptMacroPipeline('{{hasvar::missing}}|{{hasglobalvar::theme}}', c),
      'false|true',
    )
  })

  it('strips comments and restores escaped braces', () => {
    clearMacroTemplateCache()
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
    clearMacroTemplateCache()
    const c = ctx()
    assert.equal(
      applyPromptMacroPipeline('{{setvar::tag::{{char}}}}{{getvar::tag}}', c),
      '艾拉',
    )
  })

  it('supports scoped setvar blocks', () => {
    clearMacroTemplateCache()
    const c = ctx()
    const out = applyPromptMacroPipeline(
      '{{setvar note}}line1\nline2{{/setvar}}{{getvar::note}}',
      c,
    )
    assert.equal(out, 'line1\nline2')
  })
})
