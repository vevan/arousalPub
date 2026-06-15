import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getUserDataDir } from './config.js'
import { sanitizeMacroVarMap } from './prompt-macros/macro-var-limits.js'
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
import {
  BUDGET_TRIM_SETTINGS_DEFAULTS,
  normalizeBudgetTrimSettings,
  type BudgetTrimSettings,
  type BudgetTrimSettingsOverride,
} from './budget-trim-settings.js'
import {
  DEFAULT_AUTHORS_NOTE_TEMPLATE,
  normalizeDefaultAuthorsNoteTemplate,
  type DefaultAuthorsNotePatch,
  type DefaultAuthorsNoteTemplate,
} from './authors-note-settings.js'
import { prepareHybridFtsSettings } from './hybrid-fts-dict.js'
import {
  HYBRID_FTS_SETTINGS_DEFAULTS,
  normalizeHybridFtsSettings,
  profileRequiresDict,
  type HybridFtsSettings,
} from './hybrid-fts-settings.js'
import {
  resolveSecretFromDisk,
  secretToDiskFields,
  type EncryptedSecretV1,
} from './secret-encryption.js'
import {
  getMemoizedPreferencesDoc,
  invalidateRequestPreferencesMemo,
  setMemoizedPreferencesDoc,
} from './request-preferences-memo.js'

export interface UserPreferencesDocument {
  version: 1
  savedAt: string
  lorebook?: Partial<LorebookSettings>
  history?: Partial<HistorySettings>
  memory?: Partial<MemorySettings>
  budgetTrim?: Partial<BudgetTrimSettings>
  embeddingApi?: Partial<EmbeddingApiSettings>
  chunk?: Partial<ChunkSettings>
  defaultAuthorsNote?: DefaultAuthorsNoteTemplate
  hybridFts?: Partial<HybridFtsSettings>
  /** ST 式全局宏变量（`{{setglobalvar}}` / `{{getglobalvar}}`） */
  macroGlobalVars?: Record<string, string>
}

type EmbeddingApiSettingsDisk = Partial<EmbeddingApiSettings> & {
  apiKeyEnc?: EncryptedSecretV1
}

interface UserPreferencesDocumentDisk {
  version: 1
  savedAt: string
  lorebook?: Partial<LorebookSettings>
  history?: Partial<HistorySettings>
  memory?: Partial<MemorySettings>
  budgetTrim?: Partial<BudgetTrimSettings>
  embeddingApi?: EmbeddingApiSettingsDisk
  chunk?: Partial<ChunkSettings>
  defaultAuthorsNote?: DefaultAuthorsNoteTemplate
  hybridFts?: Partial<HybridFtsSettings>
  macroGlobalVars?: Record<string, string>
}

function normalizeMacroGlobalVars(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  return sanitizeMacroVarMap(raw)
}

function aadForEmbeddingApiKey(userId: string): string {
  return `arousal:${userId}:embedding`
}

function embeddingApiFromDisk(
  raw: EmbeddingApiSettingsDisk | undefined,
  userId: string,
): Partial<EmbeddingApiSettings> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const apiKey = resolveSecretFromDisk(
    typeof raw.apiKey === 'string' ? raw.apiKey : undefined,
    raw.apiKeyEnc,
    { aad: aadForEmbeddingApiKey(userId) },
  )
  const { apiKeyEnc: _e, apiKey: _p, ...rest } = raw
  return { ...rest, apiKey }
}

function embeddingApiToDisk(
  settings: Partial<EmbeddingApiSettings> | undefined,
  userId: string,
): EmbeddingApiSettingsDisk | undefined {
  if (!settings) return undefined
  const normalized = normalizeEmbeddingApiSettings(settings)
  const { apiKey, ...rest } = normalized
  const { keyEnc: apiKeyEnc } = secretToDiskFields(apiKey, {
    aad: aadForEmbeddingApiKey(userId),
  })
  const disk: EmbeddingApiSettingsDisk = { ...rest }
  if (apiKeyEnc) disk.apiKeyEnc = apiKeyEnc
  return disk
}

function preferencesToDisk(
  doc: UserPreferencesDocument,
  userId: string,
): UserPreferencesDocumentDisk {
  return {
    version: 1,
    savedAt: doc.savedAt,
    lorebook: doc.lorebook,
    history: doc.history,
    memory: doc.memory,
    budgetTrim: doc.budgetTrim,
    embeddingApi: embeddingApiToDisk(doc.embeddingApi, userId),
    chunk: doc.chunk,
    defaultAuthorsNote: doc.defaultAuthorsNote,
    hybridFts: doc.hybridFts,
  }
}

function userPreferencesPath(): string {
  return path.join(getUserDataDir(getCurrentUserId()), 'user-preferences.json')
}

async function readPreferencesFileFromDisk(): Promise<UserPreferencesDocument | null> {
  try {
    const raw = await readFile(userPreferencesPath(), 'utf8')
    const doc = JSON.parse(raw) as UserPreferencesDocument
    if (doc?.version === 1) return doc
  } catch {
    /* missing */
  }
  return null
}

async function readPreferencesFileRaw(): Promise<UserPreferencesDocument | null> {
  const cached = getMemoizedPreferencesDoc()
  if (cached !== undefined) return cached
  const doc = await readPreferencesFileFromDisk()
  setMemoizedPreferencesDoc(doc)
  return doc
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

export async function readGlobalBudgetTrimSettings(): Promise<BudgetTrimSettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...BUDGET_TRIM_SETTINGS_DEFAULTS }
  return normalizeBudgetTrimSettings(doc.budgetTrim)
}

export async function readGlobalEmbeddingApiSettings(): Promise<EmbeddingApiSettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...EMBEDDING_API_SETTINGS_DEFAULTS }
  const fromDisk = embeddingApiFromDisk(
    doc.embeddingApi as EmbeddingApiSettingsDisk | undefined,
    getCurrentUserId(),
  )
  return normalizeEmbeddingApiSettings(fromDisk)
}

export async function readGlobalChunkSettings(): Promise<ChunkSettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...CHUNK_SETTINGS_DEFAULTS }
  return normalizeChunkSettings(doc.chunk)
}

export async function readGlobalHybridFtsSettings(): Promise<HybridFtsSettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...HYBRID_FTS_SETTINGS_DEFAULTS }
  return normalizeHybridFtsSettings(doc.hybridFts)
}

export async function readGlobalDefaultAuthorsNote(): Promise<DefaultAuthorsNoteTemplate> {
  const doc = await readPreferencesFileRaw()
  if (!doc?.defaultAuthorsNote) return { ...DEFAULT_AUTHORS_NOTE_TEMPLATE }
  return normalizeDefaultAuthorsNoteTemplate(doc.defaultAuthorsNote)
}

export async function readUserPreferencesDocument(): Promise<UserPreferencesDocument> {
  const doc = await readPreferencesFileRaw()
  const lorebook = normalizeLorebookSettings(doc?.lorebook)
  const history = normalizeHistorySettings(doc?.history)
  const memory = normalizeMemorySettings(doc?.memory)
  const budgetTrim = normalizeBudgetTrimSettings(doc?.budgetTrim)
  const embeddingApi = await readGlobalEmbeddingApiSettings()
  const chunk = normalizeChunkSettings(doc?.chunk)
  const defaultAuthorsNote = normalizeDefaultAuthorsNoteTemplate(
    doc?.defaultAuthorsNote,
  )
  const hybridFts = normalizeHybridFtsSettings(doc?.hybridFts)
  return {
    version: 1,
    savedAt:
      typeof doc?.savedAt === 'string' ? doc.savedAt : new Date().toISOString(),
    lorebook,
    history,
    memory,
    budgetTrim,
    embeddingApi,
    chunk,
    defaultAuthorsNote,
    hybridFts,
    macroGlobalVars: normalizeMacroGlobalVars(doc?.macroGlobalVars),
  }
}

async function writeUserPreferencesDocument(
  partial: Pick<
    UserPreferencesDocument,
    | 'lorebook'
    | 'history'
    | 'memory'
    | 'budgetTrim'
    | 'embeddingApi'
    | 'chunk'
    | 'defaultAuthorsNote'
    | 'hybridFts'
    | 'macroGlobalVars'
  >,
): Promise<UserPreferencesDocument> {
  const prev = await readUserPreferencesDocument()
  const doc: UserPreferencesDocument = {
    version: 1,
    savedAt: new Date().toISOString(),
    lorebook: partial.lorebook ?? prev.lorebook,
    history: partial.history ?? prev.history,
    memory: partial.memory ?? prev.memory,
    budgetTrim: partial.budgetTrim ?? prev.budgetTrim,
    embeddingApi: partial.embeddingApi ?? prev.embeddingApi,
    chunk: partial.chunk ?? prev.chunk,
    defaultAuthorsNote: partial.defaultAuthorsNote ?? prev.defaultAuthorsNote,
    hybridFts: partial.hybridFts ?? prev.hybridFts,
    macroGlobalVars: partial.macroGlobalVars ?? prev.macroGlobalVars,
  }
  await mkdir(getUserDataDir(getCurrentUserId()), { recursive: true })
  const userId = getCurrentUserId()
  const disk = preferencesToDisk(doc, userId)
  await writeFile(userPreferencesPath(), JSON.stringify(disk, null, 2), 'utf8')
  invalidateRequestPreferencesMemo()
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
    budgetTrim: prev.budgetTrim,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
    defaultAuthorsNote: prev.defaultAuthorsNote,
    hybridFts: prev.hybridFts,
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
    budgetTrim: prev.budgetTrim,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
    defaultAuthorsNote: prev.defaultAuthorsNote,
    hybridFts: prev.hybridFts,
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
    budgetTrim: prev.budgetTrim,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
    defaultAuthorsNote: prev.defaultAuthorsNote,
    hybridFts: prev.hybridFts,
  })
  return memory
}

export async function updateGlobalBudgetTrimSettings(
  patch: BudgetTrimSettingsOverride,
): Promise<BudgetTrimSettings> {
  const prev = await readUserPreferencesDocument()
  const prevTrim = normalizeBudgetTrimSettings(prev.budgetTrim)
  const budgetTrim = normalizeBudgetTrimSettings({
    trimOrder: Object.prototype.hasOwnProperty.call(patch, 'trimOrder')
      ? patch.trimOrder
      : prevTrim.trimOrder,
    minRetain: {
      ...prevTrim.minRetain,
      ...(patch.minRetain ?? {}),
    },
  })
  await writeUserPreferencesDocument({
    lorebook: prev.lorebook,
    history: prev.history,
    memory: prev.memory,
    budgetTrim,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
    defaultAuthorsNote: prev.defaultAuthorsNote,
    hybridFts: prev.hybridFts,
  })
  return budgetTrim
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
    budgetTrim: prev.budgetTrim,
    embeddingApi,
    chunk: prev.chunk,
    defaultAuthorsNote: prev.defaultAuthorsNote,
    hybridFts: prev.hybridFts,
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
    budgetTrim: prev.budgetTrim,
    embeddingApi: prev.embeddingApi,
    chunk,
    hybridFts: prev.hybridFts,
  })
  return chunk
}

export async function updateGlobalHybridFtsSettings(
  patch: Partial<HybridFtsSettings>,
): Promise<HybridFtsSettings> {
  const prev = await readUserPreferencesDocument()
  const hybridFts = normalizeHybridFtsSettings({
    ...prev.hybridFts,
    ...patch,
  })
  await writeUserPreferencesDocument({
    lorebook: prev.lorebook,
    history: prev.history,
    memory: prev.memory,
    budgetTrim: prev.budgetTrim,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
    defaultAuthorsNote: prev.defaultAuthorsNote,
    hybridFts,
  })
  if (profileRequiresDict(hybridFts.profile)) {
    await prepareHybridFtsSettings(hybridFts, getCurrentUserId())
  }
  return hybridFts
}

export async function updateGlobalDefaultAuthorsNote(
  patch: DefaultAuthorsNotePatch | null,
): Promise<DefaultAuthorsNoteTemplate> {
  const prev = await readUserPreferencesDocument()
  const defaultAuthorsNote =
    patch === null
      ? { ...DEFAULT_AUTHORS_NOTE_TEMPLATE }
      : normalizeDefaultAuthorsNoteTemplate({
          ...prev.defaultAuthorsNote,
          ...patch,
        })
  await writeUserPreferencesDocument({
    lorebook: prev.lorebook,
    history: prev.history,
    memory: prev.memory,
    budgetTrim: prev.budgetTrim,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
    defaultAuthorsNote,
  })
  return defaultAuthorsNote
}

export async function readGlobalMacroGlobalVars(): Promise<Record<string, string>> {
  const doc = await readPreferencesFileRaw()
  return normalizeMacroGlobalVars(doc?.macroGlobalVars)
}

export async function updateGlobalMacroGlobalVars(
  vars: Record<string, string>,
): Promise<Record<string, string>> {
  const prev = await readUserPreferencesDocument()
  const macroGlobalVars = normalizeMacroGlobalVars(vars)
  await writeUserPreferencesDocument({
    lorebook: prev.lorebook,
    history: prev.history,
    memory: prev.memory,
    budgetTrim: prev.budgetTrim,
    embeddingApi: prev.embeddingApi,
    chunk: prev.chunk,
    defaultAuthorsNote: prev.defaultAuthorsNote,
    hybridFts: prev.hybridFts,
    macroGlobalVars,
  })
  return macroGlobalVars
}
