import { randomBytes } from 'node:crypto'

/** 新会话：8 位十六进制；仍接受历史 UUID 目录 */
export const CONVERSATION_ID_RE =
  /^([0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

export function isValidConversationId(id: string): boolean {
  return CONVERSATION_ID_RE.test(id.trim())
}

/** 生成 8 位十六进制会话 id（约 43 亿组合，内网场景足够） */
export function generateConversationId(): string {
  return randomBytes(4).toString('hex')
}
