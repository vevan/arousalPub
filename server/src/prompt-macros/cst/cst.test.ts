import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractMacroCharacterFields } from '../character-fields.js'
import { buildPromptMacroContext } from '../context.js'
import { renderPromptMacrosCst } from './render.js'

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
    Record<string, unknown> = {},
) {
  return buildPromptMacroContext({
    conversationUserName: '小明',
    characters: [
      { name: '艾拉', macroFields: extractMacroCharacterFields(sampleCard) },
      { name: '鲍勃' },
    ],
    model: 'gpt-test',
    contextLength: 8192,
    now: new Date('2026-06-10T15:04:05Z'),
    ...overrides,
  })
}

describe('CST macro engine', () => {
  it('expands simple macros (D0)', () => {
    const out = renderPromptMacrosCst('{{user}}|{{char}}|{{char2}}', ctx())
    assert.equal(out, '小明|艾拉|鲍勃')
  })

  it('marks unknown macros', () => {
    assert.equal(
      renderPromptMacrosCst('{{unknownMacro}}', ctx()),
      '[unknownMacro UNSUPPORTED]',
    )
  })

  it('strips comments and restores escaped braces', () => {
    assert.equal(renderPromptMacrosCst('a{{// note}}b', ctx()), 'ab')
    assert.equal(renderPromptMacrosCst('\\{\\{user\\}\\}', ctx()), '{{user}}')
  })

  it('expands nested macro arguments', () => {
    const c = ctx()
    assert.equal(
      renderPromptMacrosCst('{{setvar::tag::{{char}}}}{{getvar::tag}}', c),
      '艾拉',
    )
    assert.equal(c.macroLocalVars?.tag, '艾拉')
  })

  it('marks unclosed tags', () => {
    assert.equal(renderPromptMacrosCst('x{{user', ctx()), 'x[UNSUPPORTED]')
  })

  it('expands ST {{if}} / {{else}} blocks (D1)', () => {
    assert.equal(renderPromptMacrosCst('{{if user}}yes{{/if}}', ctx()), 'yes')
    assert.equal(
      renderPromptMacrosCst('{{if description}}D{{else}}E{{/if}}', ctx()),
      'D',
    )
    assert.equal(
      renderPromptMacrosCst('{{if !description}}X{{/if}}', ctx()),
      '',
    )
  })

  it('supports getvar/setvar and shorthands (D1)', () => {
    const c = ctx()
    assert.equal(
      renderPromptMacrosCst('{{setvar::k::v}}{{getvar::k}}', c),
      'v',
    )
    assert.equal(c.macroVarsDirty, true)

    const c2 = ctx({ macroLocalVars: { mood: 'happy' } })
    assert.equal(renderPromptMacrosCst('{{.mood}}', c2), 'happy')
  })

  it('supports global vars and hasvar (D1)', () => {
    const c = ctx({ macroGlobalVars: { theme: 'dark' } })
    assert.equal(renderPromptMacrosCst('{{$theme}}', c), 'dark')
    assert.equal(
      renderPromptMacrosCst(
        '{{hasvar::missing}}|{{hasglobalvar::theme}}',
        c,
      ),
      'false|true',
    )
  })

  it('supports scoped setvar blocks (D1)', () => {
    const c = ctx()
    const out = renderPromptMacrosCst(
      '{{setvar note}}line1\nline2{{/setvar}}{{getvar::note}}',
      c,
    )
    assert.equal(out, 'line1\nline2')
  })
})
