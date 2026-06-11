import { parseMacroTagInner } from '../macro-tag-parse.js'
import { lexMacroText } from './lexer.js'
import type { CstDocument, CstNode } from './nodes.js'

export function parseMacroDocument(text: string): CstDocument {
  const nodes: CstNode[] = []
  for (const token of lexMacroText(text)) {
    if (token.kind === 'text') {
      if (token.value) nodes.push({ kind: 'text', value: token.value })
      continue
    }
    if (token.kind === 'unclosed') {
      nodes.push({ kind: 'unclosed', value: token.value })
      continue
    }
    nodes.push({ kind: 'macro', tag: parseMacroTagInner(token.inner) })
  }
  return { nodes }
}
