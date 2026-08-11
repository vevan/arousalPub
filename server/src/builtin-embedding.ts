import os from 'node:os'
import path from 'node:path'

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

export type BuiltinEmbeddingProgress = Record<string, unknown>

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

async function loadFeatureExtractor(options?: {
  onProgress?: (progress: BuiltinEmbeddingProgress) => void
}): Promise<FeatureExtractor> {
  if (extractorLoaderOverride) return extractorLoaderOverride(options)
  const transformers = await import('@huggingface/transformers')
  transformers.env.cacheDir = resolveBuiltinEmbeddingCacheDir()
  const extractor = await transformers.pipeline(
    'feature-extraction',
    BUILTIN_EMBEDDING_MODEL_ID,
    {
      revision: BUILTIN_EMBEDDING_MODEL_REVISION,
      dtype: BUILTIN_EMBEDDING_DTYPE,
      device: BUILTIN_EMBEDDING_DEVICE,
      progress_callback: options?.onProgress,
    },
  )
  return extractor as unknown as FeatureExtractor
}

export async function prepareBuiltinEmbedding(options?: {
  onProgress?: (progress: BuiltinEmbeddingProgress) => void
}): Promise<void> {
  if (!extractorPromise) {
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
  cacheDir: string
  model: string
  profile: string
  dimensions: number
  dtype: typeof BUILTIN_EMBEDDING_DTYPE
  device: typeof BUILTIN_EMBEDDING_DEVICE
  error?: string
} {
  return {
    state,
    cacheDir: resolveBuiltinEmbeddingCacheDir(),
    model: BUILTIN_EMBEDDING_MODEL,
    profile: BUILTIN_EMBEDDING_PROFILE,
    dimensions: BUILTIN_EMBEDDING_DIMENSIONS,
    dtype: BUILTIN_EMBEDDING_DTYPE,
    device: BUILTIN_EMBEDDING_DEVICE,
    ...(lastError ? { error: lastError } : {}),
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
}
