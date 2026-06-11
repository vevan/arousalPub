import type { ParsedMacroTag } from '../macro-tag-parse.js'

export type CstNode =
  | { kind: 'text'; value: string }
  | { kind: 'macro'; tag: ParsedMacroTag }
  | { kind: 'unclosed'; value: string }

export interface CstDocument {
  nodes: CstNode[]
}
