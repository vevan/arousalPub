export interface BranchTreeNodeDto {
  path: string
  label?: string
  forkTurnId: string | null
  forkOrdinal: number | null
  forkMessageId?: string
  /** 该分支子树内独有 turn 数（不含共享前缀） */
  turnCount: number
  /** 沿 active 路径合并后的总 turn 数（含 fork 点前缀） */
  mergedTurnCount?: number
  children: BranchTreeNodeDto[]
}

export interface BranchTreeResponse {
  activeBranchPath: string
  nodes: BranchTreeNodeDto[]
}
