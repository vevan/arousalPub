import { parseMacroTagInner } from '../macro-tag-parse.js'
import { preprocessMacroEscapes } from '../preprocess-escape.js'
import {
  extractIfCondition,
  findIfBlockClose,
  findScopedBlockClose,
  readBalancedMacroInner,
} from './block-parse.js'
import type { CstDocument, CstNode } from './nodes.js'
import { expandVariableShorthand } from './shorthand.js'

const SCOPED_BLOCK_MACROS = new Set([
  'setvar',
  'setglobalvar',
  'reverse',
  'trim',
])

function parseNodesFromText(text: string): CstNode[] {
  const nodes: CstNode[] = []
  let cursor = 0
  while (cursor < text.length) {
    const open = text.indexOf('{{', cursor)
    if (open < 0) {
      const tail = text.slice(cursor)
      if (tail) nodes.push({ kind: 'text', value: tail })
      break
    }
    if (open > cursor) {
      nodes.push({ kind: 'text', value: text.slice(cursor, open) })
    }

    const macro = readBalancedMacroInner(text, open)
    if (!macro) {
      nodes.push({ kind: 'unclosed', value: text.slice(open) })
      break
    }

    const tag = parseMacroTagInner(macro.inner)
    if (tag.isComment) {
      cursor = macro.end
      continue
    }

    if (tag.name === 'if' && !tag.isClose && !tag.isElse) {
      const blockClose = findIfBlockClose(text, macro.end)
      if (blockClose) {
        const thenEnd = blockClose.elseStart ?? blockClose.closeStart
        const thenNodes = parseNodesFromText(text.slice(macro.end, thenEnd))
        let elseNodes: CstNode[] | undefined
        if (blockClose.elseStart !== undefined) {
          const elseOpen = text.indexOf('{{', blockClose.elseStart)
          if (elseOpen >= 0) {
            const elseMacro = readBalancedMacroInner(text, elseOpen)
            if (elseMacro) {
              elseNodes = parseNodesFromText(
                text.slice(elseMacro.end, blockClose.closeStart),
              )
            }
          }
        }
        nodes.push({
          kind: 'if',
          condition: extractIfCondition(macro.inner),
          then: thenNodes,
          else: elseNodes,
        })
        cursor = blockClose.closeEnd
        continue
      }
    }

    if (
      SCOPED_BLOCK_MACROS.has(tag.name) &&
      !tag.isClose &&
      !tag.isElse &&
      !macro.inner.includes('::')
    ) {
      const scopedClose = findScopedBlockClose(text, tag.name, macro.end)
      if (scopedClose) {
        nodes.push({
          kind: 'scoped',
          tag,
          body: parseNodesFromText(text.slice(macro.end, scopedClose.closeStart)),
        })
        cursor = scopedClose.closeEnd
        continue
      }
    }

    nodes.push({
      kind: 'macro',
      tag: expandVariableShorthand(tag),
    })
    cursor = macro.end
  }
  return nodes
}

export function parseMacroDocument(text: string): CstDocument {
  const normalized = preprocessMacroEscapes(text)
  if (!normalized.includes('{{')) {
    return {
      nodes: normalized ? [{ kind: 'text', value: normalized }] : [],
    }
  }
  return { nodes: parseNodesFromText(normalized) }
}
