import { usePreferencesStore } from '@/stores/preferences'

/** 与服务端 updateConversationAuditDebug 对齐的期望值 */
function desiredAuditDebugFromPrefs(prefStore: ReturnType<typeof usePreferencesStore>): {
  enabled: boolean
  maxStored: number
} {
  const enabled = prefStore.writeChatPromptSnapshot === true
  const maxStored = Math.min(
    200,
    Math.max(1, Math.floor(Number(prefStore.promptDebugMaxStored)) || 10),
  )
  return { enabled, maxStored }
}

function auditDebugFromIndex(
  idx: Record<string, unknown> | null | undefined,
): { enabled: boolean; maxStored: number } | null {
  const raw = idx?.auditDebug
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as { enabled?: unknown; maxStored?: unknown }
  return {
    enabled: o.enabled === true,
    maxStored:
      typeof o.maxStored === 'number' && Number.isFinite(o.maxStored)
        ? Math.min(200, Math.max(0, Math.floor(o.maxStored)))
        : -1,
  }
}

function auditDebugMatchesPrefs(
  prefStore: ReturnType<typeof usePreferencesStore>,
  current: { enabled: boolean; maxStored: number } | null,
): boolean {
  if (!current || current.maxStored < 0) return false
  const desired = desiredAuditDebugFromPrefs(prefStore)
  return (
    current.enabled === desired.enabled && current.maxStored === desired.maxStored
  )
}

async function patchAuditDebugToServer(
  prefStore: ReturnType<typeof usePreferencesStore>,
  id: string,
) {
  await fetch(`/api/chat/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auditDebug: {
        enabled: prefStore.writeChatPromptSnapshot,
        maxStored: prefStore.promptDebugMaxStored,
      },
    }),
  })
}

/** 仅当会话 auditDebug 与全局 Debug 偏好不一致时才 PATCH（打开对话默认不写盘） */
export async function syncAuditDebugIfNeeded(
  id: string,
  idx?: Record<string, unknown> | null,
): Promise<void> {
  const prefStore = usePreferencesStore()
  const current = auditDebugFromIndex(idx ?? null)
  if (auditDebugMatchesPrefs(prefStore, current)) return
  await patchAuditDebugToServer(prefStore, id)
}
