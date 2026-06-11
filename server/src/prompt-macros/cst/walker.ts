import { restoreMacroEscapes } from '../preprocess-escape.js'
import type { PromptMacroContext } from '../types.js'
import { invokeCstMacro } from './macro-registry.js'
import type { CstDocument } from './nodes.js'
import { parseMacroDocument } from './parser.js'

export function walkCstDocument(
  doc: CstDocument,
  ctx: PromptMacroContext,
): string {
  const renderNested = (snippet: string) =>
    walkCstDocument(parseMacroDocument(snippet), ctx)

  let out = ''
  for (const node of doc.nodes) {
    if (node.kind === 'text') {
      out += node.value
      continue
    }
    if (node.kind === 'unclosed') {
      out += '[UNSUPPORTED]'
      continue
    }
    out += invokeCstMacro(node.tag, ctx, renderNested)
  }
  return restoreMacroEscapes(out)
}
