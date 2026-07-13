import { getCurrentUserId } from './user-context.js'
import { isValidShortId } from './short-id.js'
import { buildFileMediaUrl } from './shared/file-media-token.js'

/**
 * 文件库内容公开 URL：`/api/m/:token`
 * token 内编码 userId + fileId；**无** JWT / access_token。独立于立绘 `/api/i/`。
 */
export function fileContentUrl(fileId: string, userId?: string): string {
  const id = fileId.trim().toLowerCase()
  const uid = (userId ?? getCurrentUserId()).trim().toLowerCase()
  if (!isValidShortId(id) || !isValidShortId(uid)) {
    throw new Error('invalid fileContentUrl ids')
  }
  return buildFileMediaUrl({ userId: uid, fileId: id })
}
