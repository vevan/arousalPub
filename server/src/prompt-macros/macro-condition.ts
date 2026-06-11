import {
  evaluateComparison,
  parseComparisonExpression,
  resolveComparisonOperand,
  unwrapConditionBraces,
} from './macro-expr.js'
import { normalizeMacroHead } from './macro-values.js'
import { getGlobalVar, getLocalVar } from './macro-vars.js'
import { isStTruthy } from './macro-truthy.js'
import type { PromptMacroContext } from './types.js'

/** ST `{{if condition}}` 条件求值（含 `==` / `!=` 比较表达式） */
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

  c = unwrapConditionBraces(c)

  if (c.includes('{{') && renderSnippet) {
    c = renderSnippet(c).trim()
    c = unwrapConditionBraces(c)
  }

  const comparison = parseComparisonExpression(c)
  if (comparison) {
    const left = resolveComparisonOperand(comparison.left, ctx, renderSnippet)
    const right = resolveComparisonOperand(comparison.right, ctx, renderSnippet)
    const result = evaluateComparison(left, right, comparison.op)
    return invert ? !result : result
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
