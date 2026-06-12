import { evaluateStCondition } from '../macro-condition.js'
import {
  evaluateVariableShorthand,
  parseVariableShorthand,
} from '../macro-shorthand-op.js'
import { trimScopedBlockContent } from '../macro-truthy.js'
import { restoreMacroEscapes } from '../preprocess-escape.js'
import type { PromptMacroContext } from '../types.js'
import type { ParsedMacroTag } from '../macro-tag-parse.js'
import { invokeCstMacro, invokeCstScopedMacro } from './macro-registry.js'
import type { CstDocument, CstNode } from './nodes.js'
import { parseMacroDocument } from './parser.js'

/** 嵌套宏展开最大深度（含顶层） */
export const MAX_MACRO_NEST_DEPTH = 32

/** 单次 parse / 嵌套片段最大字符数 */
export const MAX_MACRO_DOCUMENT_CHARS = 512_000

function isNoArgTrimTag(tag: ParsedMacroTag): boolean {
  return tag.name === 'trim' && !tag.raw.includes('::') && !tag.args.trim()
}

export function walkCstDocument(
  doc: CstDocument,
  ctx: PromptMacroContext,
  depth = 0,
): string {
  if (depth > MAX_MACRO_NEST_DEPTH) return '[UNSUPPORTED]'
  return restoreMacroEscapes(walkCstNodes(doc.nodes, ctx, depth))
}

function walkCstNodes(
  nodes: CstNode[],
  ctx: PromptMacroContext,
  depth: number,
): string {
  const renderNested = (snippet: string) => {
    if (depth + 1 > MAX_MACRO_NEST_DEPTH) return '[UNSUPPORTED]'
    if (snippet.length > MAX_MACRO_DOCUMENT_CHARS) return '[UNSUPPORTED]'
    return walkCstDocument(parseMacroDocument(snippet), ctx, depth + 1)
  }

  let out = ''
  for (const node of nodes) {
    if (node.kind === 'macro' && isNoArgTrimTag(node.tag)) {
      out = out.trimEnd()
      continue
    }
    out += walkCstNode(node, ctx, depth, renderNested)
  }
  return out
}

function walkCstNode(
  node: CstNode,
  ctx: PromptMacroContext,
  depth: number,
  renderNested: (snippet: string) => string,
): string {
  if (node.kind === 'text') return node.value
  if (node.kind === 'unclosed') return '[UNSUPPORTED]'

  if (node.kind === 'if') {
    const cond = node.condition
    if (
      evaluateStCondition(cond, ctx, (snippet) => {
        if (depth + 1 > MAX_MACRO_NEST_DEPTH) return '[UNSUPPORTED]'
        if (snippet.length > MAX_MACRO_DOCUMENT_CHARS) return '[UNSUPPORTED]'
        return walkCstDocument(parseMacroDocument(snippet), ctx, depth + 1)
      })
    ) {
      return walkCstNodes(node.then, ctx, depth)
    }
    if (node.else) return walkCstNodes(node.else, ctx, depth)
    return ''
  }

  if (node.kind === 'scoped') {
    const bodyText = walkCstNodes(node.body, ctx, depth)
    return invokeCstScopedMacro(node.tag, bodyText, ctx)
  }

  const shorthand = parseVariableShorthand(node.tag.raw)
  if (shorthand && shorthand.op !== 'get') {
    const out = evaluateVariableShorthand(node.tag.raw, ctx, renderNested)
    if (out !== null) return out
  }

  return invokeCstMacro(node.tag, ctx, renderNested)
}
