import type { BranchTreeNodeDto } from './conversation-branches-types.js'

/** 子树内分支独有 turn 总数（不含共享前缀） */
export function collectSubtreeSuffixTurnCount(node: BranchTreeNodeDto): number {
  let total = node.turnCount
  for (const child of node.children) {
    total += collectSubtreeSuffixTurnCount(child)
  }
  return total
}
