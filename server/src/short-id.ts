import { randomBytes } from 'node:crypto'

/** 实体 id（会话目录名、角色卡文件名）：8 位十六进制 */
export const SHORT_ID_RE = /^[0-9a-f]{8}$/i

const LEGACY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidShortId(id: string): boolean {
  return SHORT_ID_RE.test(id.trim())
}

export function isLegacyUuid(id: string): boolean {
  return LEGACY_UUID_RE.test(id.trim())
}

export function generateShortId(): string {
  return randomBytes(4).toString('hex')
}

export function allocateShortId(used: Set<string>): string {
  let id: string
  do {
    id = generateShortId()
  } while (used.has(id))
  used.add(id)
  return id
}

export function mapToShortId(oldId: string, used: Set<string>): string {
  const t = oldId.trim()
  if (!t) return t
  if (isValidShortId(t) && !used.has(t)) {
    used.add(t)
    return t
  }
  return allocateShortId(used)
}
