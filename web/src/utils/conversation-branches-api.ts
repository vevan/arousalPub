import { apiErrorFromResponseBody } from '@/utils/api-error-message'

/** 与 server `BRANCH_LABEL_MAX_LENGTH` 一致 */
export const BRANCH_LABEL_MAX_LENGTH = 64

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

export interface CreateBranchResult {
  path: string
  forkTurnId: string
  forkOrdinal: number
  activeBranchPath: string
}

async function errorFromResponse(res: Response): Promise<string> {
  const data = await res.json().catch(() => null)
  return apiErrorFromResponseBody(data, `http_${res.status}`)
}

export async function fetchConversationBranchTree(
  conversationId: string,
): Promise<BranchTreeResponse> {
  const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/branches`)
  if (!res.ok) {
    throw new Error(await errorFromResponse(res))
  }
  return (await res.json()) as BranchTreeResponse
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
  if (!res.ok) {
    throw new Error(await errorFromResponse(res))
  }
  return (await res.json()) as CreateBranchResult
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
  if (!res.ok) {
    throw new Error(await errorFromResponse(res))
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
  if (!res.ok) {
    throw new Error(await errorFromResponse(res))
  }
  return (await res.json()) as { path: string; label?: string }
}

export async function deleteConversationBranch(
  conversationId: string,
  branchPath: string,
): Promise<{ path: string; activeBranchPath: string }> {
  const qs = new URLSearchParams({ path: branchPath.trim() })
  const res = await fetch(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/branches?${qs}`,
    { method: 'DELETE' },
  )
  if (!res.ok) {
    throw new Error(await errorFromResponse(res))
  }
  return (await res.json()) as { path: string; activeBranchPath: string }
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

export function branchPathLabel(
  path: string,
  node: BranchTreeNodeDto | undefined,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (!path) return t('chat.branches.mainPath')
  if (node?.label?.trim()) return node.label.trim()
  const seg = path.split('/').pop() ?? path
  return t('chat.branches.unnamed', { path: seg })
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
