import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import unzipper from 'unzipper'
import {
  dictVariantEntryForProfile,
  catalogEntryForProfile,
  type DictVariantCatalogEntry,
} from './hybrid-fts-catalog.js'
import {
  normalizeHybridFtsDictVariant,
  normalizeHybridFtsSettings,
  profileRequiresDict,
  type HybridFtsDictVariant,
  type HybridFtsProfile,
  type HybridFtsSettings,
  type LinderaDictKind,
} from './hybrid-fts-settings.js'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

const HYBRID_FTS_ROOT = 'hybrid-fts'
const LINDERA_REQUIRED_FILES = [
  'char_def.bin',
  'dict.da',
  'dict.vals',
  'dict.words',
  'dict.wordsidx',
  'matrix.mtx',
  'metadata.json',
  'unk.bin',
] as const
const MAX_LINDERA_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
const MAX_DICT_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
const DICT_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000

function maxDownloadBytesForEntry(entry: DictVariantCatalogEntry): number {
  const approxBytes = Math.max(entry.sizeMbApprox, 1) * 1024 * 1024
  return Math.min(Math.max(approxBytes * 3, 32 * 1024 * 1024), MAX_DICT_DOWNLOAD_BYTES)
}

type ProgressListener = (progress: DictDownloadProgress) => void
type DownloadInflight = {
  promise: Promise<void>
  listeners: Set<ProgressListener>
}

const downloadInflight = new Map<string, DownloadInflight>()

/** 本地导入占用；与在线下载互斥，避免两端同时覆盖同一 variant */
const importLocks = new Set<string>()

export type DictImportFailureReason =
  | 'variant_not_importable'
  | 'dict_variant_invalid'
  | 'package_mismatch'
  | 'archive_invalid'
  | 'install_conflict'

export class DictImportError extends Error {
  constructor(
    readonly reason: DictImportFailureReason,
    message: string,
  ) {
    super(message)
    this.name = 'DictImportError'
  }
}

function installKey(
  userId: string,
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
): string {
  return `${userId}\0${profile}\0${variant}`
}

function resolveUserId(userId?: string): string {
  return userId ?? getCurrentUserId()
}

/** 用户 Hybrid FTS 资源根：`data/{userId}/hybrid-fts/` */
export function hybridFtsRoot(userId: string): string {
  return path.join(getUserDataDir(userId), HYBRID_FTS_ROOT)
}

/**
 * Lance `LANCE_LANGUAGE_MODEL_HOME`：每个 profile+规格自带完整 model 子树。
 * 例：`…/hybrid-fts/zh-jieba/big/`、`…/hybrid-fts/lindera/ipadic/`
 */
export function hybridFtsModelHome(
  userId: string,
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
): string {
  return path.join(hybridFtsRoot(userId), profile, variant)
}

function isLinderaKind(variant: HybridFtsDictVariant): variant is LinderaDictKind {
  return (
    variant === 'ipadic' ||
    variant === 'ipadic-neologd' ||
    variant === 'unidic' ||
    variant === 'ko-dic' ||
    variant === 'cc-cedict' ||
    variant === 'jieba'
  )
}

/** Lindera 词典目录：相对 model home 的 `lindera/{kind}/` */
export function linderaDictDir(
  userId: string,
  kind: LinderaDictKind,
): string {
  return path.join(hybridFtsModelHome(userId, 'lindera', kind), 'lindera', kind)
}

export function linderaConfigPath(userId: string, kind: LinderaDictKind): string {
  return path.join(linderaDictDir(userId, kind), 'config.yml')
}

/** 某规格词典就绪探针路径（jieba=dict.txt；lindera=config.yml） */
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
  if (profile === 'lindera' && isLinderaKind(variant)) {
    return linderaConfigPath(userId, variant)
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

async function hasCompleteLinderaDictionary(dir: string): Promise<boolean> {
  try {
    const files = await Promise.all(
      LINDERA_REQUIRED_FILES.map((name) => stat(path.join(dir, name))),
    )
    return files.every((file) => file.isFile() && file.size > 0)
  } catch {
    return false
  }
}

/**
 * 词典文件齐全时，按当前绝对路径重写 config.yml。
 * 用于数据目录搬迁后免重下。
 */
async function ensureLinderaConfigCurrent(
  userId: string,
  kind: LinderaDictKind,
): Promise<boolean> {
  const dictDir = linderaDictDir(userId, kind)
  if (!(await hasCompleteLinderaDictionary(dictDir))) return false
  const expected = linderaConfigYaml(dictDir)
  const cfg = linderaConfigPath(userId, kind)
  try {
    if (existsSync(cfg) && (await readFile(cfg, 'utf8')) === expected) {
      return true
    }
  } catch {
    /* rewrite below */
  }
  try {
    await writeFile(cfg, expected, 'utf8')
    return true
  } catch {
    return false
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
  if (profile === 'lindera' && isLinderaKind(variant)) {
    return ensureLinderaConfigCurrent(uid, variant)
  }
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
  artifactKind?: 'file' | 'zip'
  languageHint?: 'ja' | 'ko' | 'zh'
  tags?: readonly string[]
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
      artifactKind: v.artifactKind,
      languageHint: v.languageHint,
      tags: v.tags,
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
  phase?: 'download' | 'extract'
}

async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (p: DictDownloadProgress) => void,
  maxBytes: number = MAX_DICT_DOWNLOAD_BYTES,
): Promise<void> {
  const controller = new AbortController()
  let idleTimer: NodeJS.Timeout
  const resetIdleTimer = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), DICT_DOWNLOAD_IDLE_TIMEOUT_MS)
  }
  resetIdleTimer()
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`dict download failed: HTTP ${res.status} from ${url}`)
    }
    const totalBytes = Number(res.headers.get('content-length') ?? '') || null
    if (totalBytes != null && totalBytes > maxBytes) {
      throw new Error(`dict download exceeds size limit: ${totalBytes} > ${maxBytes}`)
    }
    await mkdir(path.dirname(destPath), { recursive: true })
    const body = res.body
    if (!body) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > maxBytes) {
        throw new Error(`dict download exceeds size limit: ${buf.length} > ${maxBytes}`)
      }
      await writeFile(destPath, buf)
      onProgress?.({ receivedBytes: buf.length, totalBytes: buf.length })
      return
    }
    let receivedBytes = 0
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        resetIdleTimer()
        receivedBytes += chunk.length
        if (receivedBytes > maxBytes) {
          callback(new Error(`dict download exceeds size limit: ${receivedBytes} > ${maxBytes}`))
          return
        }
        onProgress?.({ receivedBytes, totalBytes })
        callback(null, chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(body as import('node:stream/web').ReadableStream),
      progress,
      createWriteStream(destPath, { flags: 'wx' }),
    )
  } finally {
    clearTimeout(idleTimer!)
  }
}

async function downloadTextDict(
  entry: DictVariantCatalogEntry,
  dictPath: string,
  onProgress?: (p: DictDownloadProgress) => void,
): Promise<void> {
  const parent = path.dirname(dictPath)
  await mkdir(parent, { recursive: true })
  const work = await mkdtemp(path.join(parent, '.download-'))
  const tempPath = path.join(work, 'dict.txt')
  try {
    await downloadToFile(
      entry.downloadUrl,
      tempPath,
      onProgress,
      maxDownloadBytesForEntry(entry),
    )
    const head = await readDictHead(tempPath)
    if (head == null || !dictLooksValid(head)) {
      throw new Error('dict download returned invalid content')
    }
    await rm(dictPath, { force: true })
    await rename(tempPath, dictPath)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** 先挪开旧目录再 rename；失败时尽量恢复旧树，避免双丢。 */
async function replaceDirAtomically(
  sourceRoot: string,
  destDir: string,
): Promise<void> {
  const parent = path.dirname(destDir)
  await mkdir(parent, { recursive: true })
  const backup = path.join(
    parent,
    `.prev-${path.basename(destDir)}-${randomBytes(4).toString('hex')}`,
  )
  let backedUp = false
  if (existsSync(destDir)) {
    await rename(destDir, backup)
    backedUp = true
  }
  try {
    await rename(sourceRoot, destDir)
  } catch (err) {
    if (backedUp && !existsSync(destDir) && existsSync(backup)) {
      await rename(backup, destDir)
    }
    throw err
  }
  if (backedUp) {
    await rm(backup, { recursive: true, force: true })
  }
}

/**
 * 流式解压 zip 到同盘暂存目录；若仅有一层顶层目录则剥掉。
 * @param expectedMetadataName 若给出，则要求 metadata.json.name 与之完全一致
 */
async function extractZipToDir(
  zipPath: string,
  destDir: string,
  expectedMetadataName?: string,
): Promise<void> {
  const parent = path.dirname(destDir)
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(path.join(parent, '.install-'))
  try {
    const zip = await unzipper.Open.file(zipPath)
    let declaredUncompressedBytes = 0
    let actualUncompressedBytes = 0
    for (const entry of zip.files) {
      const raw = entry.path.replace(/\\/g, '/')
      const normalized = path.posix.normalize(raw).replace(/^\.\/+/, '')
      if (
        raw.includes('\0') ||
        path.posix.isAbsolute(raw) ||
        /^[A-Za-z]:([\\/]|$)/.test(raw) ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.split('/').some((segment) => segment === '..')
      ) {
        throw new Error(`unsafe path in lindera zip: ${raw}`)
      }
      if (!normalized || normalized === '.') continue

      const target = path.resolve(staging, ...normalized.split('/'))
      const stagingRoot = path.resolve(staging)
      if (target !== stagingRoot && !target.startsWith(`${stagingRoot}${path.sep}`)) {
        throw new Error(`unsafe path in lindera zip: ${raw}`)
      }
      if (entry.type === 'Directory') {
        await mkdir(target, { recursive: true })
        continue
      }

      declaredUncompressedBytes += entry.uncompressedSize
      if (declaredUncompressedBytes > MAX_LINDERA_UNCOMPRESSED_BYTES) {
        throw new Error('lindera zip exceeds uncompressed size limit')
      }
      await mkdir(path.dirname(target), { recursive: true })
      const sizeGuard = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          actualUncompressedBytes += chunk.length
          if (actualUncompressedBytes > MAX_LINDERA_UNCOMPRESSED_BYTES) {
            callback(new Error('lindera zip exceeds uncompressed size limit'))
            return
          }
          callback(null, chunk)
        },
      })
      await pipeline(
        entry.stream(),
        sizeGuard,
        createWriteStream(target, { flags: 'wx' }),
      )
    }

    const top = await readdir(staging, { withFileTypes: true })
    const meaningful = top.filter((e) => e.name !== '__MACOSX' && e.name !== '.DS_Store')
    let sourceRoot = staging
    if (meaningful.length === 1 && meaningful[0]!.isDirectory()) {
      sourceRoot = path.join(staging, meaningful[0]!.name)
    }
    if (!(await hasCompleteLinderaDictionary(sourceRoot))) {
      throw new Error('lindera zip does not contain a complete dictionary')
    }
    if (expectedMetadataName) {
      await assertLinderaMetadataName(sourceRoot, expectedMetadataName)
    }
    await writeFile(
      path.join(sourceRoot, 'config.yml'),
      linderaConfigYaml(destDir),
      'utf8',
    )
    await replaceDirAtomically(sourceRoot, destDir)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function assertLinderaMetadataName(
  dictRoot: string,
  expectedName: string,
): Promise<void> {
  let raw: string
  try {
    raw = await readFile(path.join(dictRoot, 'metadata.json'), 'utf8')
  } catch {
    throw new Error('lindera zip missing metadata.json')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('lindera zip metadata.json is not valid JSON')
  }
  const name =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { name?: unknown }).name
      : undefined
  if (name !== expectedName) {
    throw new Error(
      `lindera zip metadata name mismatch: expected ${expectedName}, got ${String(name)}`,
    )
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function assertZipMatchesCatalog(
  zipPath: string,
  entry: DictVariantCatalogEntry,
): Promise<void> {
  if (!entry.sha256) return
  const st = await stat(zipPath)
  if (entry.sizeBytes != null && st.size !== entry.sizeBytes) {
    throw new DictImportError(
      'package_mismatch',
      `zip size mismatch: expected ${entry.sizeBytes}, got ${st.size}`,
    )
  }
  const digest = await sha256File(zipPath)
  if (digest !== entry.sha256) {
    throw new DictImportError(
      'package_mismatch',
      `zip sha256 mismatch: expected ${entry.sha256}, got ${digest}`,
    )
  }
}

function linderaConfigYaml(dictAbsDir: string): string {
  const fileUrl = pathToFileURL(dictAbsDir).href
  return [
    'segmenter:',
    '  mode: "normal"',
    `  dictionary: "${fileUrl}"`,
    '',
  ].join('\n')
}

async function downloadLinderaZip(
  uid: string,
  kind: LinderaDictKind,
  entry: DictVariantCatalogEntry,
  onProgress?: (p: DictDownloadProgress) => void,
): Promise<void> {
  const modelHome = hybridFtsModelHome(uid, 'lindera', kind)
  const dictDir = linderaDictDir(uid, kind)
  const work = await mkdtemp(path.join(tmpdir(), 'hybrid-fts-lindera-'))
  const zipPath = path.join(work, entry.sourcePath)
  try {
    let lastDownloadProgress: DictDownloadProgress = {
      receivedBytes: 0,
      totalBytes: null,
      phase: 'download',
    }
    await downloadToFile(
      entry.downloadUrl,
      zipPath,
      (progress) => {
        lastDownloadProgress = { ...progress, phase: 'download' }
        onProgress?.(lastDownloadProgress)
      },
      maxDownloadBytesForEntry(entry),
    )
    await mkdir(modelHome, { recursive: true })
    onProgress?.({ ...lastDownloadProgress, phase: 'extract' })
    const heartbeat = setInterval(() => {
      onProgress?.({ ...lastDownloadProgress, phase: 'extract' })
    }, 15_000)
    heartbeat.unref()
    try {
      await extractZipToDir(zipPath, dictDir)
    } finally {
      clearInterval(heartbeat)
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * 把已落盘的官方 Lindera ZIP 安装到用户词典目录。
 * 与在线下载共享互斥；失败时保留旧词典。
 */
export async function installLinderaDictZipFromPath(
  zipPath: string,
  kind: LinderaDictKind,
  userId?: string,
): Promise<void> {
  const uid = resolveUserId(userId)
  const entry = dictVariantEntryForProfile('lindera', kind)
  if (!entry || entry.artifactKind !== 'zip' || !entry.sha256) {
    throw new DictImportError(
      'variant_not_importable',
      `lindera variant is not importable: ${kind}`,
    )
  }
  const key = installKey(uid, 'lindera', kind)
  if (downloadInflight.has(key) || importLocks.has(key)) {
    throw new DictImportError(
      'install_conflict',
      'another dict install for this variant is already running',
    )
  }
  importLocks.add(key)
  try {
    await installLinderaDictZipFromPathUnlocked(zipPath, kind, uid, entry)
  } finally {
    importLocks.delete(key)
  }
}

async function installLinderaDictZipFromPathUnlocked(
  zipPath: string,
  kind: LinderaDictKind,
  uid: string,
  entry: DictVariantCatalogEntry,
): Promise<void> {
  await assertZipMatchesCatalog(zipPath, entry)
  const modelHome = hybridFtsModelHome(uid, 'lindera', kind)
  const dictDir = linderaDictDir(uid, kind)
  await mkdir(modelHome, { recursive: true })
  try {
    await extractZipToDir(zipPath, dictDir, kind)
  } catch (err) {
    if (err instanceof DictImportError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('unsafe path') ||
      msg.includes('exceeds uncompressed') ||
      msg.includes('does not contain a complete dictionary') ||
      msg.includes('metadata')
    ) {
      throw new DictImportError('archive_invalid', msg)
    }
    throw err
  }
}

/**
 * 流式接收上传体到临时 ZIP，按 catalog SHA-256 自动匹配并安装。
 * @returns 匹配并安装的 variant
 */
export async function importLinderaDictZipStream(
  input: NodeJS.ReadableStream,
  opts?: {
    userId?: string
    onProgress?: (p: DictDownloadProgress) => void
  },
): Promise<LinderaDictKind> {
  const uid = resolveUserId(opts?.userId)
  const entries = catalogEntryForProfile('lindera').variants.filter(
    (entry) =>
      isLinderaKind(entry.id) &&
      entry.artifactKind === 'zip' &&
      typeof entry.sha256 === 'string' &&
      entry.sizeBytes != null,
  )
  if (entries.length === 0) {
    throw new DictImportError(
      'variant_not_importable',
      'no importable lindera variants are configured',
    )
  }

  const maxBytes = maxLinderaImportBytes()
  const work = await mkdtemp(path.join(tmpdir(), 'hybrid-fts-import-'))
  const zipPath = path.join(work, 'upload.zip')
  let key: string | null = null
  try {
    let receivedBytes = 0
    const hash = createHash('sha256')
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length
        if (receivedBytes > maxBytes) {
          callback(
            new DictImportError(
              'package_mismatch',
              `zip exceeds size limit: ${receivedBytes} > ${maxBytes}`,
            ),
          )
          return
        }
        hash.update(chunk)
        opts?.onProgress?.({
          receivedBytes,
          totalBytes: null,
          phase: 'download',
        })
        callback(null, chunk)
      },
    })
    await pipeline(input, progress, createWriteStream(zipPath, { flags: 'wx' }))
    const digest = hash.digest('hex')
    const entry = entries.find((candidate) => candidate.sha256 === digest)
    if (!entry || !isLinderaKind(entry.id)) {
      throw new DictImportError(
        'package_mismatch',
        `zip sha256 does not match any supported lindera package: ${digest}`,
      )
    }
    const kind = entry.id
    key = installKey(uid, 'lindera', kind)
    if (downloadInflight.has(key) || importLocks.has(key)) {
      throw new DictImportError(
        'install_conflict',
        'another dict install for the matched variant is already running',
      )
    }
    importLocks.add(key)

    opts?.onProgress?.({
      receivedBytes,
      totalBytes: entry.sizeBytes ?? receivedBytes,
      phase: 'extract',
    })
    // 流式路径已校验 size/sha；解压前再走一遍 assert 防 TOCTOU
    await installLinderaDictZipFromPathUnlocked(zipPath, kind, uid, entry)
    return kind
  } finally {
    if (key) importLocks.delete(key)
    await rm(work, { recursive: true, force: true })
  }
}

/** 上传路由用：覆盖目录中最大 Lindera ZIP，并预留少量 multipart 余量。 */
export function maxLinderaImportBytes(): number {
  const largest = catalogEntryForProfile('lindera').variants.reduce(
    (max, entry) => Math.max(max, entry.sizeBytes ?? 0),
    0,
  )
  if (largest === 0) return 64 * 1024 * 1024
  // 略留余量；精确匹配仍由 sizeBytes / sha256 门禁
  return Math.min(largest + 1024 * 1024, MAX_DICT_DOWNLOAD_BYTES)
}

export async function downloadDictVariant(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  onProgress?: (p: DictDownloadProgress) => void,
  userId?: string,
): Promise<void> {
  if (!profileRequiresDict(profile)) return
  const normalizedVariant = normalizeHybridFtsDictVariant(variant, profile)
  const entry = dictVariantEntryForProfile(profile, normalizedVariant)
  if (!entry) {
    throw new Error(`unsupported dict variant: ${variant}`)
  }
  const uid = resolveUserId(userId)
  if (await isDictVariantDownloaded(profile, normalizedVariant, uid)) return

  const key = installKey(uid, profile, normalizedVariant)
  if (importLocks.has(key)) {
    throw new DictImportError(
      'install_conflict',
      'another dict install for this variant is already running',
    )
  }
  let inflight = downloadInflight.get(key)
  if (!inflight) {
    const listeners = new Set<ProgressListener>()
    const broadcast = (progress: DictDownloadProgress) => {
      for (const listener of listeners) {
        try {
          listener(progress)
        } catch {
          /* 断开的 SSE 监听者不得中断共享下载 */
        }
      }
    }
    const promise = (async () => {
      if (profile === 'lindera' && entry.artifactKind === 'zip' && isLinderaKind(normalizedVariant)) {
        await downloadLinderaZip(uid, normalizedVariant, entry, broadcast)
        return
      }
      const dictPath = hybridFtsDictPath(uid, profile, normalizedVariant)
      await downloadTextDict(entry, dictPath, broadcast)
    })().finally(() => {
      downloadInflight.delete(key)
    })
    inflight = { promise, listeners }
    downloadInflight.set(key, inflight)
  }
  if (onProgress) {
    inflight.listeners.add(onProgress)
  }
  try {
    await inflight.promise
  } finally {
    if (onProgress) {
      inflight.listeners.delete(onProgress)
    }
  }
}

export async function ensureDictVariantReady(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
  userId: string,
): Promise<void> {
  if (!profileRequiresDict(profile)) return
  const normalized = normalizeHybridFtsDictVariant(variant, profile)
  const ready = await isDictVariantDownloaded(profile, normalized, userId)
  if (!ready) {
    throw new Error(
      `dict not downloaded: ${profile}:${normalized} (place files at ${hybridFtsDictPathRelative(userId, profile, normalized)})`,
    )
  }
}

/** zh-jieba / lindera 等需词典的分词器：返回该规格对应的 Lance model home；否则 null */
export function languageModelHomeForSettings(
  userId: string,
  settings: HybridFtsSettings,
): string | null {
  const n = normalizeHybridFtsSettings(settings)
  if (!profileRequiresDict(n.profile)) return null
  const variant = normalizeHybridFtsDictVariant(n.dictVariant, n.profile)
  return hybridFtsModelHome(userId, n.profile, variant)
}

export async function prepareHybridFtsSettings(
  settings: HybridFtsSettings,
  userId: string,
): Promise<void> {
  const n = normalizeHybridFtsSettings(settings)
  if (!profileRequiresDict(n.profile)) return
  await ensureDictVariantReady(
    n.profile,
    n.dictVariant ?? normalizeHybridFtsDictVariant(null, n.profile),
    userId,
  )
}
