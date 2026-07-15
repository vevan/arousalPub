import { isValidShortId } from './short-id.js'
import {
  getFileLibraryMeta,
  type FileLibraryKind,
} from './file-library-storage.js'

export type ConversationMediaParseError =
  | 'file_invalid_id'
  | 'file_not_found'
  | 'file_kind_mismatch'

/**
 * 解析对话级媒体 fileId：`null` / 空串 → 清除；否则须存在且 kind 匹配。
 */
export async function parseConversationMediaFileId(
  raw: unknown,
  expectedKind: FileLibraryKind,
): Promise<
  | { ok: true; fileId: string | null }
  | { ok: false; error: ConversationMediaParseError }
> {
  if (raw === null || (typeof raw === 'string' && !raw.trim())) {
    return { ok: true, fileId: null }
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'file_invalid_id' }
  }
  const id = raw.trim().toLowerCase()
  if (!isValidShortId(id)) {
    return { ok: false, error: 'file_invalid_id' }
  }
  const meta = await getFileLibraryMeta(id)
  if (!meta) return { ok: false, error: 'file_not_found' }
  if (meta.kind !== expectedKind) {
    return { ok: false, error: 'file_kind_mismatch' }
  }
  return { ok: true, fileId: id }
}
