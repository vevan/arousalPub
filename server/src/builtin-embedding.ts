import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ApiErrorCodes } from './api-error-codes.js'
import { tryGetCurrentUserId } from './user-context.js'

export const BUILTIN_EMBEDDING_MODEL_ID =
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
export const BUILTIN_EMBEDDING_MODEL_REVISION =
  '2c4055b12046f11709e9df2c122e59ffbdc2f900'
export const BUILTIN_EMBEDDING_DTYPE = 'q8' as const
export const BUILTIN_EMBEDDING_DEVICE = 'cpu' as const
export const BUILTIN_EMBEDDING_DIMENSIONS = 384
export const BUILTIN_EMBEDDING_MODEL = `builtin:${BUILTIN_EMBEDDING_MODEL_ID}`
export const BUILTIN_EMBEDDING_PROFILE =
  'builtin:multilingual-minilm-l12-v2:q8:mean:l2norm:v1'
export const BUILTIN_EMBEDDING_BATCH_MAX_INPUTS = 16
/** 单条文本硬上限（字符数），防止 CPU/内存被拖垮 */
export const BUILTIN_EMBEDDING_MAX_CHARS_PER_TEXT = 8_000
/** 单次 batch 总字符硬上限 */
export const BUILTIN_EMBEDDING_MAX_TOTAL_CHARS = 32_000
/** prepare（含首次下载）最小间隔；ready 时不限 */
export const BUILTIN_PREPARE_MIN_INTERVAL_MS = 15_000

export type BuiltinEmbeddingProgress = Record<string, unknown>

export class BuiltinEmbeddingInputError extends Error {
  readonly code = 'builtin_embedding_input_too_large' as const
  constructor(message: string) {
    super(message)
    this.name = 'BuiltinEmbeddingInputError'
  }
}

export class BuiltinEmbeddingPrepareRateLimitedError extends Error {
  readonly code = 'embedding_prepare_rate_limited' as const
  constructor(message = 'builtin embedding prepare rate limited') {
    super(message)
    this.name = 'BuiltinEmbeddingPrepareRateLimitedError'
  }
}

type FeatureExtractorOutput = {
  tolist(): unknown
}

type FeatureExtractor = (
  texts: string | string[],
  options: { pooling: 'mean'; normalize: true },
) => Promise<FeatureExtractorOutput>

type FeatureExtractorLoader = (options?: {
  onProgress?: (progress: BuiltinEmbeddingProgress) => void
}) => Promise<FeatureExtractor>

let extractorPromise: Promise<FeatureExtractor> | null = null
let extractorLoaderOverride: FeatureExtractorLoader | null = null
let state: 'not_prepared' | 'preparing' | 'ready' | 'error' = 'not_prepared'
let lastError = ''
/** Per-user prepare attempt timestamps (empty key = no user context). */
const lastPrepareAttemptByUser = new Map<string, number>()

const BUILTIN_EMBEDDING_REQUIRED_FILES = [
  'config.json',
  'tokenizer_config.json',
  'tokenizer.json',
  'onnx/model_quantized.onnx',
] as const

export function resolveBuiltinEmbeddingCacheDir(): string {
  const configured = process.env.AROUSAL_TRANSFORMERS_CACHE_DIR?.trim()
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured)
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim()
    return path.join(localAppData || os.homedir(), 'ArousalPub', 'models')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'arousal-pub', 'models')
  }
  return path.join(
    process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), '.cache'),
    'arousal-pub',
    'models',
  )
}

function resolveBuiltinEmbeddingModelDir(cacheDir: string): string {
  return path.join(
    cacheDir,
    ...BUILTIN_EMBEDDING_MODEL_ID.split('/'),
    BUILTIN_EMBEDDING_MODEL_REVISION,
  )
}

function missingBuiltinEmbeddingFiles(modelDir: string): string[] {
  return BUILTIN_EMBEDDING_REQUIRED_FILES.filter(
    (file) => !fs.existsSync(path.join(modelDir, ...file.split('/'))),
  )
}

async function loadFeatureExtractor(options?: {
  onProgress?: (progress: BuiltinEmbeddingProgress) => void
}): Promise<FeatureExtractor> {
  if (extractorLoaderOverride) return extractorLoaderOverride(options)
  const transformers = await import('@huggingface/transformers')
  const cacheDir = resolveBuiltinEmbeddingCacheDir()
  const modelDir = resolveBuiltinEmbeddingModelDir(cacheDir)
  transformers.env.cacheDir = cacheDir

  // Transformers.js 4.0.1 的 pipeline() 会先独立探测远端 tokenizer
  // 文件，且探测不沿用这里固定的 revision/cache。探测失败后它仍会创建
  // tokenizer=null 的 pipeline，直到推理时才报 `this.tokenizer is not a function`。
  // 首次使用时仍让 pipeline 负责下载；文件齐全后始终从固定 revision 的
  // 本地目录显式组装，避免后续推理依赖那次不可靠的远端探测。
  if (missingBuiltinEmbeddingFiles(modelDir).length > 0) {
    const downloaded = await transformers.pipeline(
      'feature-extraction',
      BUILTIN_EMBEDDING_MODEL_ID,
      {
        revision: BUILTIN_EMBEDDING_MODEL_REVISION,
        cache_dir: cacheDir,
        dtype: BUILTIN_EMBEDDING_DTYPE,
        device: BUILTIN_EMBEDDING_DEVICE,
        progress_callback: options?.onProgress,
      },
    )
    await downloaded.dispose()
  }

  const missingFiles = missingBuiltinEmbeddingFiles(modelDir)
  if (missingFiles.length > 0) {
    throw new Error(`内置 Embedding 模型文件不完整：${missingFiles.join(', ')}`)
  }

  const tokenizer = await transformers.AutoTokenizer.from_pretrained(
    modelDir,
    {
      local_files_only: true,
      progress_callback: options?.onProgress,
    },
  )
  const model = await transformers.AutoModel.from_pretrained(
    modelDir,
    {
      local_files_only: true,
      dtype: BUILTIN_EMBEDDING_DTYPE,
      device: BUILTIN_EMBEDDING_DEVICE,
      progress_callback: options?.onProgress,
    },
  )
  const extractor = new transformers.FeatureExtractionPipeline({
    task: 'feature-extraction',
    tokenizer,
    model,
  })
  return extractor as unknown as FeatureExtractor
}

/** Strip absolute paths from model/cache errors before returning to clients. */
export function sanitizeBuiltinEmbeddingErrorMessage(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, '[path]')
    .replace(/\\\\[^\s"'`]+/g, '[path]')
    .replace(/\/(?:[A-Za-z0-9._-]+\/)+[^\s"'`]+/g, '[path]')
}

const PREPARE_ATTEMPT_MAX_ENTRIES = 256

function prunePrepareAttemptMap(now: number): void {
  if (lastPrepareAttemptByUser.size <= PREPARE_ATTEMPT_MAX_ENTRIES) {
    // Drop expired entries opportunistically.
    for (const [key, at] of lastPrepareAttemptByUser) {
      if (now - at >= BUILTIN_PREPARE_MIN_INTERVAL_MS) {
        lastPrepareAttemptByUser.delete(key)
      }
    }
    return
  }
  // Hard cap: drop oldest half.
  const entries = [...lastPrepareAttemptByUser.entries()].sort(
    (a, b) => a[1] - b[1],
  )
  const drop = Math.ceil(entries.length / 2)
  for (let i = 0; i < drop; i++) {
    lastPrepareAttemptByUser.delete(entries[i]![0])
  }
}

/**
 * Acquire a prepare slot. Concurrent callers while `preparing` share the same
 * promise (no extra rate-limit hit). Rate-limits new download/load attempts
 * per user after errors or when not yet ready.
 */
export function tryAcquireBuiltinPrepareSlot(): boolean {
  if (state === 'ready' || state === 'preparing') return true
  const userKey = tryGetCurrentUserId() ?? ''
  const now = Date.now()
  prunePrepareAttemptMap(now)
  const last = lastPrepareAttemptByUser.get(userKey) ?? 0
  if (last > 0 && now - last < BUILTIN_PREPARE_MIN_INTERVAL_MS) {
    return false
  }
  lastPrepareAttemptByUser.set(userKey, now)
  return true
}

export async function prepareBuiltinEmbedding(options?: {
  onProgress?: (progress: BuiltinEmbeddingProgress) => void
}): Promise<void> {
  if (!extractorPromise) {
    if (!tryAcquireBuiltinPrepareSlot()) {
      throw new BuiltinEmbeddingPrepareRateLimitedError()
    }
    state = 'preparing'
    lastError = ''
    extractorPromise = loadFeatureExtractor(options)
      .then((extractor) => {
        state = 'ready'
        return extractor
      })
      .catch((error: unknown) => {
        state = 'error'
        lastError = error instanceof Error ? error.message : String(error)
        extractorPromise = null
        throw error
      })
  }
  await extractorPromise
}

export function getBuiltinEmbeddingStatus(): {
  state: 'not_prepared' | 'preparing' | 'ready' | 'error'
  model: string
  profile: string
  dimensions: number
  dtype: typeof BUILTIN_EMBEDDING_DTYPE
  device: typeof BUILTIN_EMBEDDING_DEVICE
  error?: string
} {
  return {
    state,
    model: BUILTIN_EMBEDDING_MODEL,
    profile: BUILTIN_EMBEDDING_PROFILE,
    dimensions: BUILTIN_EMBEDDING_DIMENSIONS,
    dtype: BUILTIN_EMBEDDING_DTYPE,
    device: BUILTIN_EMBEDDING_DEVICE,
    ...(lastError
      ? { error: sanitizeBuiltinEmbeddingErrorMessage(lastError) }
      : {}),
  }
}

export function assertBuiltinEmbeddingTextsWithinLimits(texts: string[]): void {
  if (texts.length > BUILTIN_EMBEDDING_BATCH_MAX_INPUTS) {
    throw new BuiltinEmbeddingInputError(
      `builtin embedding batch too large: max ${BUILTIN_EMBEDDING_BATCH_MAX_INPUTS} inputs`,
    )
  }
  let total = 0
  for (let i = 0; i < texts.length; i++) {
    const len = texts[i]!.length
    if (len > BUILTIN_EMBEDDING_MAX_CHARS_PER_TEXT) {
      throw new BuiltinEmbeddingInputError(
        `builtin embedding text ${i + 1} too long: max ${BUILTIN_EMBEDDING_MAX_CHARS_PER_TEXT} chars`,
      )
    }
    total += len
  }
  if (total > BUILTIN_EMBEDDING_MAX_TOTAL_CHARS) {
    throw new BuiltinEmbeddingInputError(
      `builtin embedding batch total too large: max ${BUILTIN_EMBEDDING_MAX_TOTAL_CHARS} chars`,
    )
  }
}

/** Map builtin embedding failures to client-safe error payloads. */
export function mapBuiltinEmbeddingError(e: unknown): {
  error: string
  detail?: string
  status?: number
} {
  if (e instanceof BuiltinEmbeddingInputError) {
    return {
      error: ApiErrorCodes.builtin_embedding_input_too_large,
      detail: sanitizeBuiltinEmbeddingErrorMessage(e.message),
      status: 400,
    }
  }
  if (e instanceof BuiltinEmbeddingPrepareRateLimitedError) {
    return {
      error: ApiErrorCodes.embedding_prepare_rate_limited,
      status: 429,
    }
  }
  return {
    error: '内置 Embedding 推理失败',
    detail: sanitizeBuiltinEmbeddingErrorMessage(
      e instanceof Error ? e.message : String(e),
    ),
  }
}

function normalizeRows(raw: unknown, expectedRows: number): number[][] {
  if (!Array.isArray(raw)) throw new Error('内置 Embedding 输出不是数组')
  const rows = expectedRows === 1 && raw.every((x) => typeof x === 'number')
    ? [raw]
    : raw
  if (rows.length !== expectedRows) {
    throw new Error(`内置 Embedding 输出条数不一致：expected ${expectedRows}, got ${rows.length}`)
  }
  return rows.map((row, index) => {
    if (!Array.isArray(row)) {
      throw new Error(`内置 Embedding 第 ${index + 1} 条输出不是数组`)
    }
    const vector = row.map((value) => Number(value))
    if (
      vector.length !== BUILTIN_EMBEDDING_DIMENSIONS ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `内置 Embedding 向量非法：expected ${BUILTIN_EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}`,
      )
    }
    return vector
  })
}

export async function createBuiltinEmbeddings(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  assertBuiltinEmbeddingTextsWithinLimits(texts)
  await prepareBuiltinEmbedding()
  const extractor = await extractorPromise!
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  return normalizeRows(output.tolist(), texts.length)
}

/** 仅测试使用：避免 CI 下载模型。 */
export function setBuiltinEmbeddingLoaderForTests(
  loader: FeatureExtractorLoader | null,
): void {
  extractorLoaderOverride = loader
  extractorPromise = null
  state = 'not_prepared'
  lastError = ''
  lastPrepareAttemptByUser.clear()
}
