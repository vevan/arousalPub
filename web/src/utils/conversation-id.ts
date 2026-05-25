/** 与 server/src/conversation-id.ts 一致：新会话 8 位 hex */
export function generateConversationId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
