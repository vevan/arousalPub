import type { BranchTreeNodeDto } from './conversation-branches-types.js'

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
