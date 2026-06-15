/** 立绘 / 头像媒体 token（9 字节 → base64url） */

export const PORTRAIT_MEDIA_KIND = {
  character: 0,
  userAvatar: 1,
} as const

export type PortraitMediaKind =
  (typeof PORTRAIT_MEDIA_KIND)[keyof typeof PORTRAIT_MEDIA_KIND]

/** 最长边像素；无 size 参数时返回原图 */
export const PORTRAIT_IMAGE_SIZE = {
  xs: 64,
  s: 128,
  m: 256,
  l: 512,
  xl: 1024,
} as const

export type PortraitImageSize = keyof typeof PORTRAIT_IMAGE_SIZE

const SHORT_ID_RE = /^[0-9a-f]{8}$/i

export interface PortraitMediaRef {
  userId: string
  imgId: string
  kind: PortraitMediaKind
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

export function encodePortraitMediaToken(ref: PortraitMediaRef): string {
  const userId = assertShortId(ref.userId, 'userId')
  const imgId = assertShortId(ref.imgId, 'imgId')
  const kind = ref.kind
  if (kind !== PORTRAIT_MEDIA_KIND.character && kind !== PORTRAIT_MEDIA_KIND.userAvatar) {
    throw new Error('invalid kind')
  }
  const payload = new Uint8Array(9)
  payload.set(hexToBytes(userId), 0)
  payload.set(hexToBytes(imgId), 4)
  payload[8] = kind
  return encodeBase64Url(payload)
}

export function decodePortraitMediaToken(token: string): PortraitMediaRef | null {
  try {
    const bytes = decodeBase64Url(token)
    if (bytes.length !== 9) return null
    const kind = bytes[8]!
    if (kind !== PORTRAIT_MEDIA_KIND.character && kind !== PORTRAIT_MEDIA_KIND.userAvatar) {
      return null
    }
    return {
      userId: bytesToHex(bytes.subarray(0, 4)),
      imgId: bytesToHex(bytes.subarray(4, 8)),
      kind: kind as PortraitMediaKind,
    }
  } catch {
    return null
  }
}

export function parsePortraitImageSize(
  raw: string | null | undefined,
): PortraitImageSize | null {
  if (raw == null || raw === '') return null
  const key = raw.trim().toLowerCase()
  if (key in PORTRAIT_IMAGE_SIZE) return key as PortraitImageSize
  return null
}

export function portraitImageMaxEdge(size: PortraitImageSize): number {
  return PORTRAIT_IMAGE_SIZE[size]
}

export function buildPortraitImageUrl(
  ref: PortraitMediaRef,
  options?: { size?: PortraitImageSize | null; cacheBust?: string | number | null },
): string {
  const token = encodePortraitMediaToken(ref)
  const params = new URLSearchParams()
  if (options?.size) params.set('size', options.size)
  if (options?.cacheBust != null && String(options.cacheBust) !== '') {
    params.set('v', String(options.cacheBust))
  }
  const q = params.toString()
  return q ? `/api/i/${token}?${q}` : `/api/i/${token}`
}

export function characterPortraitImageUrl(
  userId: string | null | undefined,
  characterId: string | null | undefined,
  options?: { size?: PortraitImageSize | null; cacheBust?: string | number | null },
): string | null {
  const uid = typeof userId === 'string' ? userId.trim() : ''
  const cid = typeof characterId === 'string' ? characterId.trim() : ''
  if (!uid || !cid || !SHORT_ID_RE.test(uid) || !SHORT_ID_RE.test(cid)) return null
  return buildPortraitImageUrl(
    { userId: uid, imgId: cid, kind: PORTRAIT_MEDIA_KIND.character },
    options,
  )
}
