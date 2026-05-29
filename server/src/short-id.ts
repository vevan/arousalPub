import { randomBytes } from 'node:crypto'

/** 8 位十六进制（会话、角色卡、用户 id、turnId 等） */
export const SHORT_ID_RE = /^[0-9a-f]{8}$/i

/** 安装时种子账号目录 `data/00000000/` */
export const RESERVED_USER_ID = '00000000'

export function isValidShortId(id: string): boolean {
  return SHORT_ID_RE.test(id.trim())
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

/** 新注册用户 id（跳过保留的 00000000） */
export function allocateUserId(used: Set<string>): string {
  const blocked = new Set(used)
  blocked.add(RESERVED_USER_ID)
  return allocateShortId(blocked)
}
