import {
  throwApiErrorFromResponseBody,
} from '@/utils/api-error-message'
import { branchPathLabel } from './branch-path-label.js'
import type { BranchTreeNodeDto, BranchTreeResponse } from './conversation-branches-types.js'

export { branchPathLabel }
export { collectSubtreeSuffixTurnCount } from './branch-tree-utils.js'
export type { BranchTreeNodeDto, BranchTreeResponse } from './conversation-branches-types.js'

/** 与 server `BRANCH_LABEL_MAX_LENGTH` 一致 */
export const BRANCH_LABEL_MAX_LENGTH = 64

export interface CreateBranchResult {
  path: string
  forkTurnId: string
  forkOrdinal: number
  activeBranchPath: string
}

function assertOkResponse(res: Response, data: unknown): void {
  if (!res.ok) {
    throwApiErrorFromResponseBody(data, `http_${res.status}`)
  }
}

export async function fetchConversationBranchTree(
  conversationId: string,
): Promise<BranchTreeResponse> {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/branches`)
  const data = await res.json().catch(() => null)
  assertOkResponse(res, data)
  return data as BranchTreeResponse
}

export async function createConversationBranch(
  conversationId: string,
  body: {
    forkTurnId: string
    forkMessageId?: string
    label?: string
    setActive?: boolean
  },
): Promise<CreateBranchResult> {
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/branches`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  const data = await res.json().catch(() => null)
  assertOkResponse(res, data)
  return data as CreateBranchResult
}

export async function patchConversationActiveBranchPath(
  conversationId: string,
  activeBranchPath: string | null,
): Promise<void> {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activeBranchPath: activeBranchPath ?? '' }),
  })
  const data = await res.json().catch(() => null)
  assertOkResponse(res, data)
}

export async function repairConversationChunkIndex(
  conversationId: string,
): Promise<{
  ok: true
  repaired: number
  branchLabelsRepaired?: number
  branchLabelRepairFailed?: number
}> {
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/repair-chunk-index`,
    { method: 'POST' },
  )
  const data = await res.json().catch(() => null)
  assertOkResponse(res, data)
  return data as {
    ok: true
    repaired: number
    branchLabelsRepaired?: number
    branchLabelRepairFailed?: number
  }
}

export async function patchConversationBranchLabel(
  conversationId: string,
  branchPath: string,
  label: string | null,
): Promise<{ path: string; label?: string }> {
  const qs = new URLSearchParams({ path: branchPath.trim() })
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/branches?${qs}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    },
  )
  const data = await res.json().catch(() => null)
  assertOkResponse(res, data)
  return data as { path: string; label?: string }
}

export async function deleteConversationBranch(
  conversationId: string,
  branchPath: string,
): Promise<{
  path: string
  activeBranchPath: string
  memoryCleanupFailed?: boolean
  activeResetFailed?: boolean
  dirCleanupFailed?: boolean
}> {
  const qs = new URLSearchParams({ path: branchPath.trim() })
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/branches?${qs}`,
    { method: 'DELETE' },
  )
  const data = await res.json().catch(() => null)
  assertOkResponse(res, data)
  return data as {
    path: string
    activeBranchPath: string
    memoryCleanupFailed?: boolean
    activeResetFailed?: boolean
    dirCleanupFailed?: boolean
  }
}

/** 有 sibling 分支的 fork turnId（用于气泡标记） */
export function collectForkTurnIdsWithSiblings(nodes: BranchTreeNodeDto[]): Set<string> {
  const out = new Set<string>()
  function walk(list: BranchTreeNodeDto[]) {
    if (list.length > 1) {
      for (const n of list) {
        if (n.forkTurnId) out.add(n.forkTurnId)
      }
    }
    for (const n of list) {
      if (n.children.length > 0) walk(n.children)
    }
  }
  for (const root of nodes) {
    walk(root.children)
  }
  return out
}

export function findBranchTreeNode(
  nodes: BranchTreeNodeDto[],
  path: string,
): BranchTreeNodeDto | undefined {
  for (const n of nodes) {
    if (n.path === path) return n
    const hit = findBranchTreeNode(n.children, path)
    if (hit) return hit
  }
  return undefined
}
