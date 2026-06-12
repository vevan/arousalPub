import type { ParsedMacroTag } from '../macro-tag-parse.js'

export type CstNode =
  | { kind: 'text'; value: string }
  | { kind: 'macro'; tag: ParsedMacroTag }
  | { kind: 'if'; condition: string; then: CstNode[]; else?: CstNode[] }
  | { kind: 'scoped'; tag: ParsedMacroTag; body: CstNode[] }
  | { kind: 'unclosed'; value: string }

export interface CstDocument {
  nodes: CstNode[]
}
