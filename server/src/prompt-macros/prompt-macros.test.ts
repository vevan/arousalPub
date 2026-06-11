import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPromptMacroContext } from './context.js'
import { clearMacroTemplateCache } from './handlebars-engine.js'
import { applyPromptMacroPipeline } from './pipeline.js'

function ctx(
  overrides: Parameters<typeof buildPromptMacroContext>[0] = {},
) {
  return buildPromptMacroContext({
    conversationUserName: '小明',
    characters: [{ name: '艾拉' }, { name: '鲍勃' }],
    model: 'gpt-test',
    contextLength: 8192,
    now: new Date('2026-06-10T15:04:05'),
    locale: 'zh-CN',
    authorsNote: '作者注正文',
    ...overrides,
  })
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
      applyPromptMacroPipeline('{{getvar::x}}', ctx()),
      '[getvar::x UNSUPPORTED]',
    )
    assert.equal(
      applyPromptMacroPipeline('前缀 {{description}} 后缀', ctx()),
      '前缀 [description UNSUPPORTED] 后缀',
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
