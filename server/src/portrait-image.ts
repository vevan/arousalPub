import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { getCharactersDir, getUserAvatarPath } from './config.js'
import { isValidShortId } from './short-id.js'
import {
  decodePortraitMediaToken,
  parsePortraitImageSize,
  PORTRAIT_MEDIA_KIND,
  portraitImageMaxEdge,
  type PortraitImageSize,
} from './shared/portrait-media-token.js'

export async function readCharacterPngBufferForUser(
  userId: string,
  characterId: string,
): Promise<Buffer | null> {
  if (!isValidShortId(userId) || !isValidShortId(characterId)) return null
  const pngPath = path.join(getCharactersDir(userId), `${characterId}.png`)
  try {
    return await readFile(pngPath)
  } catch {
    return null
  }
}

async function readPortraitSourcePng(
  userId: string,
  imgId: string,
  kind: number,
): Promise<Buffer | null> {
  if (kind === PORTRAIT_MEDIA_KIND.character) {
    return readCharacterPngBufferForUser(userId, imgId)
  }
  if (kind === PORTRAIT_MEDIA_KIND.userAvatar) {
    if (userId !== imgId) return null
    try {
      return await readFile(getUserAvatarPath(userId))
    } catch {
      return null
    }
  }
  return null
}

export async function resizePortraitPng(
  source: Buffer,
  size: PortraitImageSize,
): Promise<Buffer> {
  const maxEdge = portraitImageMaxEdge(size)
  return sharp(source)
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
}

function weakEtag(buf: Buffer): string {
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
  return `W/"${hash}"`
}

export type PortraitImageResult =
  | { ok: true; body: Buffer; etag: string }
  | { ok: false; reason: 'invalid_token' | 'invalid_size' | 'not_found' }

export async function resolvePortraitImageResponse(
  token: string,
  sizeRaw: string | null | undefined,
): Promise<PortraitImageResult> {
  const ref = decodePortraitMediaToken(token)
  if (!ref) return { ok: false, reason: 'invalid_token' }

  const size = parsePortraitImageSize(sizeRaw)
  if (sizeRaw != null && sizeRaw !== '' && !size) {
    return { ok: false, reason: 'invalid_size' }
  }

  const source = await readPortraitSourcePng(ref.userId, ref.imgId, ref.kind)
  if (!source) return { ok: false, reason: 'not_found' }

  const body = size ? await resizePortraitPng(source, size) : source
  return { ok: true, body, etag: weakEtag(body) }
}

export function portraitImageCacheControl(
  sizeRaw: string | null | undefined,
): string {
  return sizeRaw ? 'public, max-age=86400' : 'public, max-age=3600'
}
