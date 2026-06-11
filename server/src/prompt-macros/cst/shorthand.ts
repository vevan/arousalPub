import { parseVariableShorthand } from '../macro-shorthand-op.js'
import { parseMacroTagInner, type ParsedMacroTag } from '../macro-tag-parse.js'

/** Get 简写 → getvar / getglobalvar；含运算符的留给 Walker 求值 */
export function expandVariableShorthand(tag: ParsedMacroTag): ParsedMacroTag {
  if (tag.isComment || tag.isClose || tag.isElse) return tag
  const parsed = parseVariableShorthand(tag.raw)
  if (!parsed || parsed.op !== 'get') return tag
  if (parsed.scope === 'local') {
    return parseMacroTagInner(`getvar::${parsed.name}`)
  }
  return parseMacroTagInner(`getglobalvar::${parsed.name}`)
}
