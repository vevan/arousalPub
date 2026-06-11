import { getGlobalVar, getLocalVar } from './macro-vars.js'
import type { PromptMacroContext } from './types.js'

export type CompareOp = '==' | '!='

export interface ParsedComparison {
  op: CompareOp
  left: string
  right: string
}

/** 剥掉条件外层的 `{{ … }}`（`{{#if {{.x == y}}}}` 内层） */
export function unwrapConditionBraces(condition: string): string {
  let c = condition.trim()
  const m = c.match(/^\{\{([\s\S]+)\}\}$/)
  if (m) c = m[1]!.trim()
  return c
}

/** 解析 `left == right` / `left != right`（`!=` 优先于 `==`） */
export function parseComparisonExpression(
  expression: string,
): ParsedComparison | null {
  const c = expression.trim()
  const ne = c.match(/^([\s\S]+?)\s*!=\s*([\s\S]+)$/)
  if (ne) {
    return { op: '!=', left: ne[1]!.trim(), right: ne[2]!.trim() }
  }
  const eq = c.match(/^([\s\S]+?)\s*==\s*([\s\S]+)$/)
  if (eq) {
    return { op: '==', left: eq[1]!.trim(), right: eq[2]!.trim() }
  }
  return null
}

export function stripQuotes(value: string): string {
  const v = value.trim()
  if (v.length >= 2) {
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1)
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1)
  }
  return v
}

/** 求值比较表达式操作数（`==` / `!=` 两侧；右侧字面量不当作宏名） */
export function resolveComparisonOperand(
  operand: string,
  ctx: PromptMacroContext,
  renderSnippet?: (snippet: string) => string,
): string {
  let o = operand.trim()
  if (!o) return ''

  if (o.includes('{{') && renderSnippet) {
    o = renderSnippet(o).trim()
  }

  if (o.startsWith('.') && o.length > 1 && !o.startsWith('..')) {
    return getLocalVar(ctx, o.slice(1))
  }
  if (o.startsWith('$') && o.length > 1) {
    return getGlobalVar(ctx, o.slice(1))
  }
  return stripQuotes(o)
}

export function evaluateComparison(
  left: string,
  right: string,
  op: CompareOp,
): boolean {
  const l = left.trim()
  const r = right.trim()
  const eq = l === r
  return op === '==' ? eq : !eq
}
