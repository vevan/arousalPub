import { stripQuotes } from './macro-expr.js'
import {
  getGlobalVar,
  getLocalVar,
  hasGlobalVar,
  hasLocalVar,
  setGlobalVar,
  setLocalVar,
} from './macro-vars.js'
import { isStTruthy } from './macro-truthy.js'
import type { PromptMacroContext } from './types.js'

export type VarScope = 'local' | 'global'

export type ShorthandOp =
  | 'get'
  | '='
  | '++'
  | '--'
  | '+='
  | '-='
  | '||'
  | '??'
  | '||='
  | '??='
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='

export interface ParsedVarShorthand {
  scope: VarScope
  name: string
  op: ShorthandOp
  /** infix 运算符右侧（可含嵌套宏） */
  value?: string
}

const VAR_NAME_RE = /^(?:[A-Za-z][\w-]*[A-Za-z0-9]|[A-Za-z])/

const POSTFIX_OPS: ShorthandOp[] = ['++', '--']

const INFIX_OPS: ShorthandOp[] = [
  '??=',
  '||=',
  '==',
  '!=',
  '>=',
  '<=',
  '+=',
  '-=',
  '??',
  '||',
  '>',
  '<',
  '=',
]

function stripMacroFlags(body: string): string {
  let s = body.trimStart()
  if (s.startsWith('#')) s = s.slice(1).trimStart()
  if (s.startsWith('!')) s = s.slice(1).trimStart()
  return s
}

/** 解析 `{{.var op value}}` / `{{$var …}}`；非简写运算符形态返回 null */
export function parseVariableShorthand(raw: string): ParsedVarShorthand | null {
  let s = stripMacroFlags(raw)
  const scopeChar = s[0]
  if (scopeChar !== '.' && scopeChar !== '$') return null
  const scope: VarScope = scopeChar === '.' ? 'local' : 'global'
  s = s.slice(1).trimStart()

  const nameMatch = s.match(VAR_NAME_RE)
  if (!nameMatch) return null
  const name = nameMatch[0]
  const rest = s.slice(name.length).trimStart()
  if (!rest) return { scope, name, op: 'get' }

  for (const op of POSTFIX_OPS) {
    if (rest.startsWith(op) && rest.slice(op.length).trim() === '') {
      return { scope, name, op }
    }
  }

  for (const op of INFIX_OPS) {
    if (rest.startsWith(op)) {
      const value = rest.slice(op.length).trimStart()
      return { scope, name, op, value }
    }
  }

  return null
}

export function isVariableShorthandRaw(raw: string): boolean {
  return parseVariableShorthand(raw) !== null
}

function readVar(ctx: PromptMacroContext, scope: VarScope, name: string): string {
  return scope === 'local' ? getLocalVar(ctx, name) : getGlobalVar(ctx, name)
}

function writeVar(
  ctx: PromptMacroContext,
  scope: VarScope,
  name: string,
  value: string,
): void {
  if (scope === 'local') setLocalVar(ctx, name, value)
  else setGlobalVar(ctx, name, value)
}

function isVarDefined(
  ctx: PromptMacroContext,
  scope: VarScope,
  name: string,
): boolean {
  return scope === 'local' ? hasLocalVar(ctx, name) : hasGlobalVar(ctx, name)
}

function resolveRhs(
  value: string | undefined,
  ctx: PromptMacroContext,
  renderSnippet?: (snippet: string) => string,
): string {
  if (value === undefined) return ''
  let v = value
  if (v.includes('{{') && renderSnippet) {
    v = renderSnippet(v)
  }
  return stripQuotes(v.trim())
}

function stBoolString(flag: boolean): string {
  return flag ? 'true' : 'false'
}

function parseNumeric(value: string): number | null {
  const n = Number.parseFloat(value.trim())
  return Number.isFinite(n) ? n : null
}

function addAssign(current: string, delta: string): string {
  const a = parseNumeric(current)
  const b = parseNumeric(delta)
  if (a !== null && b !== null) return String(a + b)
  return current + delta
}

function subtractAssign(current: string, delta: string): string {
  const a = parseNumeric(current)
  const b = parseNumeric(delta)
  if (a === null || b === null) return current
  return String(a - b)
}

function incrementValue(current: string): string {
  const n = parseNumeric(current)
  if (n === null) return '1'
  return String(n + 1)
}

function decrementValue(current: string): string {
  const n = parseNumeric(current)
  if (n === null) return '-1'
  return String(n - 1)
}

function compareNumeric(
  left: string,
  right: string,
  op: '>' | '>=' | '<' | '<=',
): boolean {
  const a = parseNumeric(left)
  const b = parseNumeric(right)
  if (a === null || b === null) return false
  if (op === '>') return a > b
  if (op === '>=') return a >= b
  if (op === '<') return a < b
  return a <= b
}

/** 比较用：未定义变量与空串视为相同 */
function compareOperandValue(
  ctx: PromptMacroContext,
  scope: VarScope,
  name: string,
): string {
  if (!isVarDefined(ctx, scope, name)) return ''
  return readVar(ctx, scope, name).trim()
}

/** 求值简写标签；非简写返回 null */
export function evaluateVariableShorthand(
  raw: string,
  ctx: PromptMacroContext,
  renderSnippet?: (snippet: string) => string,
): string | null {
  const parsed = parseVariableShorthand(raw)
  if (!parsed) return null

  const { scope, name, op } = parsed
  const current = readVar(ctx, scope, name)

  if (op === 'get') return current

  if (op === '=') {
    writeVar(ctx, scope, name, resolveRhs(parsed.value, ctx, renderSnippet))
    return ''
  }

  if (op === '++') {
    const next = incrementValue(current)
    writeVar(ctx, scope, name, next)
    return next
  }

  if (op === '--') {
    const next = decrementValue(current)
    writeVar(ctx, scope, name, next)
    return next
  }

  if (op === '+=') {
    const delta = resolveRhs(parsed.value, ctx, renderSnippet)
    writeVar(ctx, scope, name, addAssign(current, delta))
    return ''
  }

  if (op === '-=') {
    const delta = resolveRhs(parsed.value, ctx, renderSnippet)
    writeVar(ctx, scope, name, subtractAssign(current, delta))
    return ''
  }

  const rhs = resolveRhs(parsed.value, ctx, renderSnippet)

  if (op === '||') {
    return isStTruthy(current) ? current : rhs
  }

  if (op === '??') {
    return isVarDefined(ctx, scope, name) ? current : rhs
  }

  if (op === '||=') {
    if (isStTruthy(current)) return current
    writeVar(ctx, scope, name, rhs)
    return rhs
  }

  if (op === '??=') {
    if (isVarDefined(ctx, scope, name)) return current
    writeVar(ctx, scope, name, rhs)
    return rhs
  }

  if (op === '==') {
    const left = compareOperandValue(ctx, scope, name)
    return stBoolString(left === rhs.trim())
  }

  if (op === '!=') {
    const left = compareOperandValue(ctx, scope, name)
    return stBoolString(left !== rhs.trim())
  }

  if (op === '>' || op === '>=' || op === '<' || op === '<=') {
    const left = compareOperandValue(ctx, scope, name)
    return stBoolString(compareNumeric(left, rhs, op))
  }

  return null
}
