/** 与 server/src/conversation-id.ts 一致 */
export function generateConversationId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const CONVERSATION_ID_RE = /^[0-9a-f]{8}$/i

export function isValidConversationId(id: string): boolean {
  return CONVERSATION_ID_RE.test(id.trim())
}
