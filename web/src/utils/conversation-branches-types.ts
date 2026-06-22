export interface BranchTreeNodeDto {
  path: string
  label?: string
  forkTurnId: string | null
  forkOrdinal: number | null
  forkMessageId?: string
  turnCount: number
  children: BranchTreeNodeDto[]
}

export interface BranchTreeResponse {
  activeBranchPath: string
  nodes: BranchTreeNodeDto[]
}
