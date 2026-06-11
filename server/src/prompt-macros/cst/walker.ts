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

function isNoArgTrimTag(tag: ParsedMacroTag): boolean {
  return tag.name === 'trim' && !tag.raw.includes('::') && !tag.args.trim()
}

export function walkCstDocument(
  doc: CstDocument,
  ctx: PromptMacroContext,
): string {
  return restoreMacroEscapes(walkCstNodes(doc.nodes, ctx))
}

function walkCstNodes(nodes: CstNode[], ctx: PromptMacroContext): string {
  const renderNested = (snippet: string) =>
    walkCstDocument(parseMacroDocument(snippet), ctx)

  let out = ''
  for (const node of nodes) {
    if (node.kind === 'macro' && isNoArgTrimTag(node.tag)) {
      out = out.trimEnd()
      continue
    }
    out += walkCstNode(node, ctx, renderNested)
  }
  return out
}

function walkCstNode(
  node: CstNode,
  ctx: PromptMacroContext,
  renderNested: (snippet: string) => string,
): string {
  if (node.kind === 'text') return node.value
  if (node.kind === 'unclosed') return '[UNSUPPORTED]'

  if (node.kind === 'if') {
    const cond = node.condition
    if (
      evaluateStCondition(cond, ctx, (snippet) =>
        walkCstDocument(parseMacroDocument(snippet), ctx),
      )
    ) {
      return walkCstNodes(node.then, ctx)
    }
    if (node.else) return walkCstNodes(node.else, ctx)
    return ''
  }

  if (node.kind === 'scoped') {
    const bodyText = walkCstNodes(node.body, ctx)
    return invokeCstScopedMacro(node.tag, bodyText, ctx)
  }

  const shorthand = parseVariableShorthand(node.tag.raw)
  if (shorthand && shorthand.op !== 'get') {
    const out = evaluateVariableShorthand(node.tag.raw, ctx, renderNested)
    if (out !== null) return out
  }

  return invokeCstMacro(node.tag, ctx, renderNested)
}
