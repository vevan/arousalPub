import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { dictVariantEntryForProfile, catalogEntryForProfile } from './hybrid-fts-catalog.js'
import {
  normalizeHybridFtsDictVariant,
  normalizeHybridFtsSettings,
  profileRequiresDict,
  type HybridFtsDictVariant,
  type HybridFtsProfile,
  type HybridFtsSettings,
} from './hybrid-fts-settings.js'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

const downloadInflight = new Map<string, Promise<void>>()

export function lanceLanguageModelHome(userId?: string): string {
  return path.join(getUserDataDir(userId ?? getCurrentUserId()), 'lance-language-models')
}

/** Lance 运行时读取的激活词典路径 */
export function lanceActiveDictPath(userId?: string): string {
  return path.join(lanceLanguageModelHome(userId), 'jieba', 'default', 'dict.txt')
}

/** 某规格词典的存储路径（多档并存） */
export function dictVariantStoragePath(
  variant: HybridFtsDictVariant,
  userId?: string,
): string {
  return path.join(
    lanceLanguageModelHome(userId),
    'jieba',
    'variants',
    variant,
    'dict.txt',
  )
}

function dictLooksValid(head: string): boolean {
  return head.length > 0 && !head.includes('<!DOCTYPE') && !head.includes('<html')
}

export async function isDictVariantDownloaded(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  userId?: string,
): Promise<boolean> {
  if (!profileRequiresDict(profile)) return true
  const dictPath = dictVariantStoragePath(variant, userId)
  if (!existsSync(dictPath)) {
    return migrateLegacyActiveDict(profile, variant, userId)
  }
  try {
    const head = (await readFile(dictPath, 'utf8')).slice(0, 80)
    return dictLooksValid(head)
  } catch {
    return false
  }
}

/** 旧版仅 jieba/default/dict.txt 时，视为 default 规格已下载并迁移 */
async function migrateLegacyActiveDict(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  userId?: string,
): Promise<boolean> {
  if (profile !== 'zh-jieba' || variant !== 'default') return false
  const legacy = lanceActiveDictPath(userId)
  const variantPath = dictVariantStoragePath('default', userId)
  if (!existsSync(legacy)) return false
  try {
    const head = (await readFile(legacy, 'utf8')).slice(0, 80)
    if (!dictLooksValid(head)) return false
    if (!existsSync(variantPath)) {
      await mkdir(path.dirname(variantPath), { recursive: true })
      await copyFile(legacy, variantPath)
    }
    return true
  } catch {
    return false
  }
}

export interface DictVariantStatus {
  id: HybridFtsDictVariant
  downloaded: boolean
  storagePath: string
  sourcePath: string
  downloadUrl: string
  sizeMbApprox: number
}

export interface ProfileDictStatus {
  profile: HybridFtsProfile
  requiresDict: boolean
  repoUrl: string | null
  activeDictPath: string
  variants: DictVariantStatus[]
}

export async function getProfileDictStatus(
  profile: HybridFtsProfile,
  userId?: string,
): Promise<ProfileDictStatus> {
  const catalog = catalogEntryForProfile(profile)
  const variants: DictVariantStatus[] = []
  for (const v of catalog.variants) {
    variants.push({
      id: v.id,
      downloaded: await isDictVariantDownloaded(profile, v.id, userId),
      storagePath: dictVariantStoragePath(v.id, userId),
      sourcePath: v.sourcePath,
      downloadUrl: v.downloadUrl,
      sizeMbApprox: v.sizeMbApprox,
    })
  }
  return {
    profile,
    requiresDict: catalog.requiresDict,
    repoUrl: catalog.repoUrl,
    activeDictPath: lanceActiveDictPath(userId),
    variants,
  }
}

export type DictDownloadProgress = {
  receivedBytes: number
  totalBytes: number | null
}

export async function downloadDictVariant(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  onProgress?: (p: DictDownloadProgress) => void,
  userId?: string,
): Promise<void> {
  if (!profileRequiresDict(profile)) return
  const entry = dictVariantEntryForProfile(profile, variant)
  if (!entry) {
    throw new Error(`unsupported dict variant: ${variant}`)
  }
  if (await isDictVariantDownloaded(profile, variant, userId)) return

  const key = `${userId ?? getCurrentUserId()}\0${profile}\0${variant}`
  let inflight = downloadInflight.get(key)
  if (!inflight) {
    inflight = (async () => {
      const dictPath = dictVariantStoragePath(variant, userId)
      await mkdir(path.dirname(dictPath), { recursive: true })
      const res = await fetch(entry.downloadUrl)
      if (!res.ok) {
        throw new Error(
          `dict download failed: HTTP ${res.status} from ${entry.downloadUrl}`,
        )
      }
      const totalBytes = Number(res.headers.get('content-length') ?? '') || null
      const body = res.body
      if (!body) {
        const text = await res.text()
        if (!dictLooksValid(text.slice(0, 80))) {
          throw new Error('dict download returned invalid content')
        }
        await writeFile(dictPath, text, 'utf8')
        onProgress?.({ receivedBytes: text.length, totalBytes: text.length })
        return
      }
      const reader = body.getReader()
      const chunks: Uint8Array[] = []
      let receivedBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          receivedBytes += value.length
          onProgress?.({ receivedBytes, totalBytes })
        }
      }
      const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)))
      const text = merged.toString('utf8')
      if (!dictLooksValid(text.slice(0, 80))) {
        throw new Error('dict download returned invalid content')
      }
      await writeFile(dictPath, text, 'utf8')
    })().finally(() => {
      downloadInflight.delete(key)
    })
    downloadInflight.set(key, inflight)
  }
  await inflight
}

export async function activateDictVariant(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  userId?: string,
): Promise<void> {
  if (!profileRequiresDict(profile)) return
  const normalized = normalizeHybridFtsDictVariant(variant)
  const ready = await isDictVariantDownloaded(profile, normalized, userId)
  if (!ready) {
    throw new Error(
      `dict not downloaded: ${profile}:${normalized} (place dict.txt under ${dictVariantStoragePath(normalized, userId)})`,
    )
  }
  const src = dictVariantStoragePath(normalized, userId)
  const dest = lanceActiveDictPath(userId)
  await mkdir(path.dirname(dest), { recursive: true })
  await copyFile(src, dest)
}

export function applyLanceLanguageModelHome(userId?: string): void {
  process.env.LANCE_LANGUAGE_MODEL_HOME = lanceLanguageModelHome(userId)
}

export async function prepareHybridFtsSettings(
  settings: HybridFtsSettings,
  userId?: string,
): Promise<void> {
  const n = normalizeHybridFtsSettings(settings)
  if (!profileRequiresDict(n.profile)) return
  await activateDictVariant(n.profile, n.dictVariant ?? 'default', userId)
  applyLanceLanguageModelHome(userId)
}
