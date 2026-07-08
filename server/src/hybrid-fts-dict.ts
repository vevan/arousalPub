import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

const HYBRID_FTS_ROOT = 'hybrid-fts'

const downloadInflight = new Map<string, Promise<void>>()

function resolveUserId(userId?: string): string {
  return userId ?? getCurrentUserId()
}

/** 用户 Hybrid FTS 资源根：`data/{userId}/hybrid-fts/` */
export function hybridFtsRoot(userId: string): string {
  return path.join(getUserDataDir(userId), HYBRID_FTS_ROOT)
}

/**
 * Lance `LANCE_LANGUAGE_MODEL_HOME`：每个 profile+规格自带完整 model 子树。
 * 例：`…/hybrid-fts/zh-jieba/big/`
 */
export function hybridFtsModelHome(
  userId: string,
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
): string {
  return path.join(hybridFtsRoot(userId), profile, variant)
}

/** 某规格词典文件（Lance 约定 `jieba/default/dict.txt` 相对 model home） */
export function hybridFtsDictPath(
  userId: string,
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
): string {
  if (profile === 'zh-jieba') {
    return path.join(
      hybridFtsModelHome(userId, profile, variant),
      'jieba',
      'default',
      'dict.txt',
    )
  }
  throw new Error(`unsupported dict profile: ${profile}`)
}

function dictLooksValid(head: string): boolean {
  return head.length > 0 && !head.includes('<!DOCTYPE') && !head.includes('<html')
}

async function readDictHead(dictPath: string): Promise<string | null> {
  try {
    return (await readFile(dictPath, 'utf8')).slice(0, 80)
  } catch {
    return null
  }
}

/** 相对 `data/{userId}/` 的路径（API 展示用，统一 `/` 分隔） */
export function toUserDataRelativePath(userId: string, absolutePath: string): string {
  const rel = path.relative(getUserDataDir(userId), absolutePath)
  if (rel.startsWith('..')) {
    return rel.split(path.sep).join('/')
  }
  return rel.split(path.sep).join('/')
}

function hybridFtsDictPathRelative(
  userId: string,
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
): string {
  return toUserDataRelativePath(userId, hybridFtsDictPath(userId, profile, variant))
}

function hybridFtsModelHomeRelative(
  userId: string,
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
): string {
  return toUserDataRelativePath(userId, hybridFtsModelHome(userId, profile, variant))
}

export async function isDictVariantDownloaded(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  userId?: string,
): Promise<boolean> {
  if (!profileRequiresDict(profile)) return true
  const uid = resolveUserId(userId)
  const dictPath = hybridFtsDictPath(uid, profile, variant)
  if (!existsSync(dictPath)) return false
  const head = await readDictHead(dictPath)
  return head != null && dictLooksValid(head)
}

export interface DictVariantStatus {
  id: HybridFtsDictVariant
  downloaded: boolean
  storagePath: string
  modelHome: string
  sourcePath: string
  downloadUrl: string
  sizeMbApprox: number
}

export interface ProfileDictStatus {
  profile: HybridFtsProfile
  requiresDict: boolean
  repoUrl: string | null
  variants: DictVariantStatus[]
}

export async function getProfileDictStatus(
  profile: HybridFtsProfile,
  userId?: string,
): Promise<ProfileDictStatus> {
  const uid = resolveUserId(userId)
  const catalog = catalogEntryForProfile(profile)
  const variants: DictVariantStatus[] = []
  for (const v of catalog.variants) {
    variants.push({
      id: v.id,
      downloaded: await isDictVariantDownloaded(profile, v.id, uid),
      storagePath: hybridFtsDictPathRelative(uid, profile, v.id),
      modelHome: hybridFtsModelHomeRelative(uid, profile, v.id),
      sourcePath: v.sourcePath,
      downloadUrl: v.downloadUrl,
      sizeMbApprox: v.sizeMbApprox,
    })
  }
  return {
    profile,
    requiresDict: catalog.requiresDict,
    repoUrl: catalog.repoUrl,
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
  const uid = resolveUserId(userId)
  if (await isDictVariantDownloaded(profile, variant, uid)) return

  const key = `${uid}\0${profile}\0${variant}`
  let inflight = downloadInflight.get(key)
  if (!inflight) {
    inflight = (async () => {
      const dictPath = hybridFtsDictPath(uid, profile, variant)
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

export async function ensureDictVariantReady(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  userId: string,
): Promise<void> {
  if (!profileRequiresDict(profile)) return
  const normalized = normalizeHybridFtsDictVariant(variant)
  const ready = await isDictVariantDownloaded(profile, normalized, userId)
  if (!ready) {
    throw new Error(
      `dict not downloaded: ${profile}:${normalized} (place dict.txt at ${hybridFtsDictPathRelative(userId, profile, normalized)})`,
    )
  }
}

/** zh-jieba 等需词典的分词器：返回该规格对应的 Lance model home；否则 null */
export function languageModelHomeForSettings(
  userId: string,
  settings: HybridFtsSettings,
): string | null {
  const n = normalizeHybridFtsSettings(settings)
  if (!profileRequiresDict(n.profile)) return null
  const variant = normalizeHybridFtsDictVariant(n.dictVariant)
  return hybridFtsModelHome(userId, n.profile, variant)
}

export async function prepareHybridFtsSettings(
  settings: HybridFtsSettings,
  userId: string,
): Promise<void> {
  const n = normalizeHybridFtsSettings(settings)
  if (!profileRequiresDict(n.profile)) return
  await ensureDictVariantReady(n.profile, n.dictVariant ?? 'default', userId)
}
