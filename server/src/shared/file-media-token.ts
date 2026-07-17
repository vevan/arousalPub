/** 用户文件库媒体 token（8 字节 → base64url）：userId(4) + fileId(4) → `/api/m/:token` */

const SHORT_ID_RE = /^[0-9a-f]{8}$/i

/** 图片缩放档位（与立绘语义对齐，但路由独立） */
export const FILE_MEDIA_IMAGE_SIZE = {
  xs: 64,
  s: 128,
  m: 256,
  l: 512,
  xl: 1024,
} as const

export type FileMediaImageSize = keyof typeof FILE_MEDIA_IMAGE_SIZE

export interface FileMediaRef {
  userId: string
  fileId: string
}

function assertShortId(id: string, label: string): string {
  const s = id.trim().toLowerCase()
  if (!SHORT_ID_RE.test(s)) {
    throw new Error(`invalid ${label}`)
  }
  return s
}

function hexToBytes(hex: string): Uint8Array {
  const clean = assertShortId(hex, 'id')
  const out = new Uint8Array(4)
  for (let i = 0; i < 4; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  const b64 = btoa(binary)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(token: string): Uint8Array {
  const raw = token.trim()
  if (!raw) throw new Error('empty token')
  const pad =
    raw.length % 4 === 0 ? raw : raw + '='.repeat(4 - (raw.length % 4))
  const b64 = pad.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function encodeFileMediaToken(ref: FileMediaRef): string {
  const userId = assertShortId(ref.userId, 'userId')
  const fileId = assertShortId(ref.fileId, 'fileId')
  const payload = new Uint8Array(8)
  payload.set(hexToBytes(userId), 0)
  payload.set(hexToBytes(fileId), 4)
  return encodeBase64Url(payload)
}

export function decodeFileMediaToken(token: string): FileMediaRef | null {
  try {
    const bytes = decodeBase64Url(token)
    if (bytes.length !== 8) return null
    return {
      userId: bytesToHex(bytes.subarray(0, 4)),
      fileId: bytesToHex(bytes.subarray(4, 8)),
    }
  } catch {
    return null
  }
}

export type ResolveFileIdFromRepairInputResult =
  | { ok: true; fileId: string }
  | { ok: false; error: 'invalid' | 'wrong_user' }

/**
 * 从「8 hex fileId」或「/api/m/{token}」（可含 host / query / 引号）解析 fileId。
 * URL / token 形态会校验 token 内 userId 与 expectedUserId 一致。
 */
export function resolveFileIdFromRepairInput(
  raw: string | null | undefined,
  expectedUserId: string,
): ResolveFileIdFromRepairInputResult {
  const s = String(raw ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
  if (!s) return { ok: false, error: 'invalid' }

  const uid = expectedUserId.trim().toLowerCase()
  if (!SHORT_ID_RE.test(uid)) return { ok: false, error: 'invalid' }

  if (SHORT_ID_RE.test(s)) {
    return { ok: true, fileId: s.toLowerCase() }
  }

  const token = extractFileMediaTokenFromInput(s)
  if (!token) return { ok: false, error: 'invalid' }
  const ref = decodeFileMediaToken(token)
  if (!ref) return { ok: false, error: 'invalid' }
  if (ref.userId !== uid) return { ok: false, error: 'wrong_user' }
  return { ok: true, fileId: ref.fileId }
}

/** 从路径、绝对 URL 或裸 token 抽出 media token */
function extractFileMediaTokenFromInput(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null

  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    try {
      s = new URL(s).pathname
    } catch {
      return null
    }
  } else {
    const q = s.indexOf('?')
    if (q >= 0) s = s.slice(0, q)
    const h = s.indexOf('#')
    if (h >= 0) s = s.slice(0, h)
  }

  const m = s.match(/\/api\/m\/([A-Za-z0-9_-]+)/i)
  if (m?.[1]) return m[1]

  if (/^[A-Za-z0-9_-]+$/.test(s)) return s
  return null
}

export function parseFileMediaImageSize(
  raw: string | null | undefined,
): FileMediaImageSize | null {
  if (raw == null || raw === '') return null
  const key = raw.trim().toLowerCase()
  if (key in FILE_MEDIA_IMAGE_SIZE) return key as FileMediaImageSize
  return null
}

export function fileMediaImageMaxEdge(size: FileMediaImageSize): number {
  return FILE_MEDIA_IMAGE_SIZE[size]
}

export function buildFileMediaUrl(
  ref: FileMediaRef,
  options?: {
    size?: FileMediaImageSize | null
    cacheBust?: string | number | null
  },
): string {
  const token = encodeFileMediaToken(ref)
  const params = new URLSearchParams()
  if (options?.size) params.set('size', options.size)
  if (options?.cacheBust != null && String(options.cacheBust) !== '') {
    params.set('v', String(options.cacheBust))
  }
  const q = params.toString()
  return q ? `/api/m/${token}?${q}` : `/api/m/${token}`
}

export function fileLibraryMediaUrl(
  userId: string | null | undefined,
  fileId: string | null | undefined,
  options?: {
    size?: FileMediaImageSize | null
    cacheBust?: string | number | null
  },
): string | null {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  const fid = typeof fileId === 'string' ? fileId.trim() : ''
  if (!uid || !fid || !SHORT_ID_RE.test(uid) || !SHORT_ID_RE.test(fid)) return null
  return buildFileMediaUrl({ userId: uid, fileId: fid }, options)
}
