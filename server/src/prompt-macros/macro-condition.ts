import { normalizeMacroHead } from './macro-values.js'
import { getGlobalVar, getLocalVar } from './macro-vars.js'
import { isStTruthy } from './macro-truthy.js'
import type { PromptMacroContext } from './types.js'

/** ST `{{if condition}}` 条件求值（嵌套宏应先由 nested-expand 展开） */
export function evaluateStCondition(
  condition: string,
  ctx: PromptMacroContext,
  renderSnippet?: (snippet: string) => string,
): boolean {
  let c = condition.trim()
  if (!c) return false

  let invert = false
  if (c.startsWith('!')) {
    invert = true
    c = c.slice(1).trim()
  }

  if (c.includes('{{') && renderSnippet) {
    c = renderSnippet(c).trim()
  }

  let truthy: boolean
  if (c.startsWith('.') && c.length > 1) {
    truthy = isStTruthy(getLocalVar(ctx, c.slice(1)))
  } else if (c.startsWith('$') && c.length > 1) {
    truthy = isStTruthy(getGlobalVar(ctx, c.slice(1)))
  } else if (/^[\w-]+$/.test(c) && renderSnippet) {
    const head = normalizeMacroHead(c)
    if (head === 'else' || head === 'if') {
      truthy = isStTruthy(c)
    } else {
      truthy = isStTruthy(renderSnippet(`{{${c}}}`))
    }
  } else {
    truthy = isStTruthy(c)
  }

  return invert ? !truthy : truthy
}

export { resolveHasVarMacro, resolveHasGlobalVarMacro } from './macro-vars.js'
