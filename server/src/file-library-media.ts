import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { getFilesDir } from './config.js'
import { isValidShortId } from './short-id.js'
import {
  fileMediaImageMaxEdge,
  parseFileMediaImageSize,
  type FileMediaImageSize,
} from './shared/file-media-token.js'

export type FileLibraryMediaResult =
  | {
      ok: true
      mode: 'buffer'
      body: Buffer
      mime: string
      etag: string
      name: string
    }
  | {
      ok: true
      mode: 'stream'
      contentPath: string
      mime: string
      size: number
      etag: string
      name: string
      stream: ReturnType<typeof createReadStream>
    }
  | { ok: false; reason: 'invalid_size' | 'not_found' }

function weakEtag(payload: string | Buffer): string {
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 16)
  return `W/"${hash}"`
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

async function resizeImagePreservePng(
  source: Buffer,
  size: FileMediaImageSize,
): Promise<Buffer> {
  const maxEdge = fileMediaImageMaxEdge(size)
  return sharp(source)
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
}

export function fileMediaCacheControl(
  sizeRaw: string | null | undefined,
): string {
  return sizeRaw ? 'public, max-age=86400' : 'public, max-age=3600'
}

/**
 * 公开 `/api/m/:token` 解析。
 * 图片 + size= 时缓冲缩放为 PNG；其余流式原文件。
 */
export async function resolveFileLibraryMediaResponse(
  userId: string,
  fileId: string,
  sizeRaw: string | null | undefined,
): Promise<FileLibraryMediaResult> {
  if (!isValidShortId(userId) || !isValidShortId(fileId)) {
    return { ok: false, reason: 'not_found' }
  }
  const uid = userId.trim().toLowerCase()
  const fid = fileId.trim().toLowerCase()
  const dir = path.join(getFilesDir(uid), fid)
  const metaPath = path.join(dir, 'meta.json')
  const contentPath = path.join(dir, 'content')

  let mime = 'application/octet-stream'
  let name = fid
  let byteSize = 0
  let updatedAt = ''
  try {
    const raw = JSON.parse(await readFile(metaPath, 'utf8')) as {
      mime?: string
      name?: string
      size?: number
      updatedAt?: string
      fileId?: string
    }
    if (raw.fileId && raw.fileId !== fid) return { ok: false, reason: 'not_found' }
    if (typeof raw.mime === 'string' && raw.mime) mime = raw.mime
    if (typeof raw.name === 'string' && raw.name) name = raw.name
    if (typeof raw.size === 'number') byteSize = raw.size
    if (typeof raw.updatedAt === 'string') updatedAt = raw.updatedAt
  } catch {
    return { ok: false, reason: 'not_found' }
  }

  const size = parseFileMediaImageSize(sizeRaw)
  if (sizeRaw != null && sizeRaw !== '' && !size) {
    return { ok: false, reason: 'invalid_size' }
  }

  if (size && isImageMime(mime)) {
    try {
      const source = await readFile(contentPath)
      const body = await resizeImagePreservePng(source, size)
      return {
        ok: true,
        mode: 'buffer',
        body,
        mime: 'image/png',
        etag: weakEtag(body),
        name,
      }
    } catch {
      return { ok: false, reason: 'not_found' }
    }
  }

  try {
    const etag = weakEtag(`${fid}:${byteSize}:${updatedAt}:${mime}`)
    return {
      ok: true,
      mode: 'stream',
      contentPath,
      mime,
      size: byteSize,
      etag,
      name,
      stream: createReadStream(contentPath),
    }
  } catch {
    return { ok: false, reason: 'not_found' }
  }
}
