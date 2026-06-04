import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'
import {
  HISTORY_SETTINGS_DEFAULTS,
  normalizeHistorySettings,
  type HistorySettings,
} from './history-settings.js'
import {
  LOREBOOK_SETTINGS_DEFAULTS,
  normalizeLorebookSettings,
  type LorebookSettings,
} from './lorebook-settings.js'
import {
  EMBEDDING_API_SETTINGS_DEFAULTS,
  mergeEmbeddingApiPatch,
  normalizeEmbeddingApiSettings,
  type EmbeddingApiSettings,
} from './embedding-api-settings.js'
import {
  MEMORY_SETTINGS_DEFAULTS,
  normalizeMemorySettings,
  type MemorySettings,
} from './memory-settings.js'
import {
  CHUNK_SETTINGS_DEFAULTS,
  normalizeChunkSettings,
  type ChunkSettings,
} from './chunk-settings.js'

export interface UserPreferencesDocument {
  version: 1
  savedAt: string
  lorebook?: Partial<LorebookSettings>
  history?: Partial<HistorySettings>
  memory?: Partial<MemorySettings>
  embeddingApi?: Partial<EmbeddingApiSettings>
  chunk?: Partial<ChunkSettings>
}

function userPreferencesPath(): string {
  return path.join(getUserDataDir(getCurrentUserId()), 'user-preferences.json')
}

async function readPreferencesFileRaw(): Promise<UserPreferencesDocument | null> {
  try {
    const raw = await readFile(userPreferencesPath(), 'utf8')
    const doc = JSON.parse(raw) as UserPreferencesDocument
    if (doc?.version === 1) return doc
  } catch {
    /* missing */
  }
  return null
}

export async function readGlobalLorebookSettings(): Promise<LorebookSettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...LOREBOOK_SETTINGS_DEFAULTS }
  return normalizeLorebookSettings(doc.lorebook)
}

export async function readGlobalHistorySettings(): Promise<HistorySettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...HISTORY_SETTINGS_DEFAULTS }
  return normalizeHistorySettings(doc.history)
}

export async function readGlobalMemorySettings(): Promise<MemorySettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...MEMORY_SETTINGS_DEFAULTS }
  return normalizeMemorySettings(doc.memory)
}

export async function readGlobalEmbeddingApiSettings(): Promise<EmbeddingApiSettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...EMBEDDING_API_SETTINGS_DEFAULTS }
  return normalizeEmbeddingApiSettings(doc?.embeddingApi)
}

export async function readGlobalChunkSettings(): Promise<ChunkSettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...CHUNK_SETTINGS_DEFAULTS }
  return normalizeChunkSettings(doc.chunk)
}

export async function readUserPreferencesDocument(): Promise<UserPreferencesDocument> {
  const doc = await readPreferencesFileRaw()
  const lorebook = normalizeLorebookSettings(doc?.lorebook)
  const history = normalizeHistorySettings(doc?.history)
  const memory = normalizeMemorySettings(doc?.memory)
  const embeddingApi = await readGlobalEmbeddingApiSettings()
  const chunk = normalizeChunkSettings(doc?.chunk)
  return {
    version: 1,
    savedAt:
      typeof doc?.savedAt === 'string' ? doc.savedAt : new Date().toISOString(),
    lorebook,
    history,
    memory,
    embeddingApi,
    chunk,
  }
}

async function writeUserPreferencesDocument(
  partial: Pick<
    UserPreferencesDocument,
    'lorebook' | 'history' | 'memory' | 'embeddingApi' | 'chunk'
  >,
): Promise<UserPreferencesDocument> {
  const prev = await readUserPreferencesDocument()
  const doc: UserPreferencesDocument = {
    version: 1,
    savedAt: new Date().toISOString(),
    lorebook: partial.lorebook ?? prev.lorebook,
    history: partial.history ?? prev.history,
    memory: partial.memory ?? prev.memory,
    embeddingApi: partial.embeddingApi ?? prev.embeddingApi,
    chunk: partial.chunk ?? prev.chunk,
  }
  await mkdir(getUserDataDir(getCurrentUserId()), { recursive: true })
  await writeFile(userPreferencesPath(), JSON.stringify(doc, null, 2), 'utf8')
  return doc
}

export async function updateGlobalLorebookSettings(
  patch: Partial<LorebookSettings>,
): Promise<LorebookSettings> {
  const prev = await readUserPreferencesDocument()
  const lorebook = normalizeLorebookSettings({
    ...prev.lorebook,
    ...patch,
  })
  await writeUserPreferencesDocument({
    lorebook,
    history: prev.history,
    memory: prev.memory,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
  })
  return lorebook
}

export async function updateGlobalHistorySettings(
  patch: Partial<HistorySettings>,
): Promise<HistorySettings> {
  const prev = await readUserPreferencesDocument()
  const history = normalizeHistorySettings({
    ...prev.history,
    ...patch,
  })
  await writeUserPreferencesDocument({
    lorebook: prev.lorebook,
    history,
    memory: prev.memory,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
  })
  return history
}

export async function updateGlobalMemorySettings(
  patch: Partial<MemorySettings>,
): Promise<MemorySettings> {
  const prev = await readUserPreferencesDocument()
  const memory = normalizeMemorySettings({
    ...prev.memory,
    ...patch,
  })
  await writeUserPreferencesDocument({
    lorebook: prev.lorebook,
    history: prev.history,
    memory,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
  })
  return memory
}

export async function updateGlobalEmbeddingApiSettings(
  patch: Partial<EmbeddingApiSettings>,
): Promise<EmbeddingApiSettings> {
  const prev = await readUserPreferencesDocument()
  const embeddingApi = normalizeEmbeddingApiSettings(
    mergeEmbeddingApiPatch(
      normalizeEmbeddingApiSettings(prev.embeddingApi),
      patch,
    ),
  )
  await writeUserPreferencesDocument({
    lorebook: prev.lorebook,
    history: prev.history,
    memory: prev.memory,
    embeddingApi,
    chunk: prev.chunk,
  })
  return embeddingApi
}

export async function updateGlobalChunkSettings(
  patch: Partial<ChunkSettings>,
): Promise<ChunkSettings> {
  const prev = await readUserPreferencesDocument()
  const chunk = normalizeChunkSettings({
    ...prev.chunk,
    ...patch,
  })
  await writeUserPreferencesDocument({
    lorebook: prev.lorebook,
    history: prev.history,
    memory: prev.memory,
    embeddingApi: prev.embeddingApi,
    chunk,
  })
  return chunk
}
