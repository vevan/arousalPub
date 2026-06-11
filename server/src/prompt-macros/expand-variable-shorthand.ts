import {
  findNextBalancedMacroTag,
  parseMacroTagInner,
} from './macro-tag-parse.js'
import {
  evaluateVariableShorthand,
  isVariableShorthandRaw,
} from './macro-shorthand-op.js'
import type { PromptMacroContext } from './types.js'

/** 将文本中 `{{.…}}` / `{{$…}}` 简写（含运算符）替换为求值结果 */
export function expandVariableShorthandTags(
  text: string,
  ctx: PromptMacroContext,
  renderSnippet: (snippet: string) => string,
): string {
  if (!text.includes('{{')) return text
  let result = ''
  let cursor = 0
  while (cursor < text.length) {
    const tag = findNextBalancedMacroTag(text, cursor)
    if (!tag) {
      result += text.slice(cursor)
      break
    }
    result += text.slice(cursor, tag.start)
    const parsed = parseMacroTagInner(tag.inner)
    if (
      !parsed.isComment &&
      !parsed.isClose &&
      !parsed.isElse &&
      isVariableShorthandRaw(tag.inner)
    ) {
      const value = evaluateVariableShorthand(tag.inner, ctx, renderSnippet)
      if (value !== null) {
        result += value
        cursor = tag.end
        continue
      }
    }
    result += text.slice(tag.start, tag.end)
    cursor = tag.end
  }
  return result
}
