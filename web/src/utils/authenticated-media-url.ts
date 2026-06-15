import { useAuthStore } from '@/stores/auth'
import {
  characterPortraitImageUrl,
  type PortraitImageSize,
} from '@/shared/portrait-media-token'

/**
 * 为需登录的 GET 图片 URL 附加 access_token（供 img / 新窗口打开，浏览器不会带 Bearer）。
 */
function withAccessToken(
  path: string,
  extraQuery?: Record<string, string>,
): string {
  const auth = useAuthStore()
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(extraQuery ?? {})) {
    if (v !== '') params.set(k, v)
  }
  if (auth.token) {
    params.set('access_token', auth.token)
  }
  const q = params.toString()
  return q ? `${path}?${q}` : path
}

export function characterImageUrl(
  userId: string | null | undefined,
  characterId: string | null | undefined,
  options?: {
    size?: PortraitImageSize | null
    cacheBust?: number | string | null
  },
): string | null {
  return characterPortraitImageUrl(userId, characterId, options)
}

export function userAvatarUrl(
  userId: string | null | undefined,
  cacheBust?: number | string,
): string | null {
  const clean = typeof userId === 'string' ? userId.trim() : ''
  if (!clean || !/^[0-9a-f]{8}$/i.test(clean)) return null
  const extra: Record<string, string> = {}
  if (cacheBust != null) extra.v = String(cacheBust)
  return withAccessToken(`/api/users/${clean}/avatar`, extra)
}

export type { PortraitImageSize } from '@/shared/portrait-media-token'
