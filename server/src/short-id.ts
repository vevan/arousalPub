import { randomBytes } from 'node:crypto'

/** 8 位十六进制（会话、角色卡、turnId、receive.id、prompt 条目等） */
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

/** 是否应将 id 从 UUID / prefix-uuid 迁为 8 位 hex（保留 preset-default、binding-slot-* 等语义 id） */
export function shouldMigrateToShortId(id: string): boolean {
  const t = id.trim()
  if (!t || isValidShortId(t)) return false
  if (isLegacyUuid(t)) return true
  const m = t.match(/^(preset|group|entry|binding)-(.+)$/i)
  if (m && isLegacyUuid(m[2]!)) return true
  return false
}
