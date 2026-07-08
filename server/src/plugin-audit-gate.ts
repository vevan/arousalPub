import { readConversationIndex } from './chat-storage.js'
import { isAuditDebugWriteEnabled } from './chat-audit-file.js'

/**
 * 插件出站 debug（captureDebug / debugCapture）仅当会话 auditDebug 写入开启时生效。
 * 客户端/插件请求 true 时仍由宿主以 index.auditDebug 为准（B1.2）。
 */
export async function resolvePluginCaptureDebug(
  conversationId: string | undefined,
  requested?: boolean,
): Promise<boolean> {
  if (requested !== true) return false
  const cid = conversationId?.trim()
  if (!cid) return false
  const idx = await readConversationIndex(cid)
  if (!idx) return false
  return isAuditDebugWriteEnabled(idx)
}
