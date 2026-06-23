import type { BranchTreeNodeDto } from './conversation-branches-types.js'

/** 子树内分支独有 turn 总数（不含共享前缀） */
export function collectSubtreeSuffixTurnCount(node: BranchTreeNodeDto): number {
  let total = node.turnCount
  for (const child of node.children) {
    total += collectSubtreeSuffixTurnCount(child)
  }
  return total
}

export type BranchTurnRangeParts = {
  from?: number
  to: number
  total: number
}

/** 分支树节点轮次范围：分叉点 / 合并路径末轮 / 分支独有轮数 */
export function branchTurnRangeParts(node: BranchTreeNodeDto): BranchTurnRangeParts | null {
  const total = node.turnCount
  const to =
    node.mergedTurnCount ??
    (node.forkOrdinal != null ? node.forkOrdinal + total : total)

  if (node.path) {
    if (node.forkOrdinal == null) {
      return total > 0 || to > 0 ? { to, total } : null
    }
    return { from: node.forkOrdinal, to, total }
  }

  if (total <= 0 && to <= 0) return null
  return { to, total }
}
