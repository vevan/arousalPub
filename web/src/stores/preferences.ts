import {
  HISTORY_SETTINGS_DEFAULTS,
  normalizeHistorySettings,
  type HistorySettings,
} from '@/utils/history-settings'
import {
  LOREBOOK_SETTINGS_DEFAULTS,
  normalizeLorebookSettings,
  type LorebookSettings,
} from '@/utils/lorebook-settings'
import {
  EMBEDDING_API_SETTINGS_DEFAULTS,
  normalizeEmbeddingApiSettings,
  normalizeEmbeddingDimensions,
  type EmbeddingApiSettings,
} from '@/utils/embedding-api-settings'
import {
  MEMORY_SETTINGS_DEFAULTS,
  normalizeMemorySettings,
  type MemorySettings,
} from '@/utils/memory-settings'
import {
  CHAT_FONT_SIZE_REM_DEFAULT,
  COMPOSER_ENTER_MODE_DEFAULT,
  normalizeChatFontSizeRem,
  normalizeComposerEnterMode,
  type ComposerEnterMode,
} from '@/utils/chat-display-settings'
import {
  CHUNK_SETTINGS_DEFAULTS,
  normalizeChunkSettings,
  type ChunkSettings,
} from '@/utils/chunk-settings'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useApiKeysStore } from '@/stores/apiKeys'

export const CHAT_PROMPT_WRITE_STORAGE_KEY = 'arousal-chat-write-prompt-snapshot'
export const PROMPT_DEBUG_MAX_STORED_KEY = 'arousal-chat-prompt-debug-max-stored'
export const LOREBOOK_RECURSIVE_STORAGE_KEY = 'arousal-lorebook-recursive-enabled'
export const LOREBOOK_DEPTH_STORAGE_KEY = 'arousal-lorebook-max-recursion-depth'
export const LOREBOOK_VECTOR_ENABLED_STORAGE_KEY = 'arousal-lorebook-vector-enabled'
export const LOREBOOK_VECTOR_TOPK_STORAGE_KEY = 'arousal-lorebook-vector-topk'
export const HISTORY_LIMIT_STORAGE_KEY = 'arousal-history-limit-enabled'
export const HISTORY_MAX_TURNS_STORAGE_KEY = 'arousal-history-max-turns'
export const MEMORY_ENABLED_STORAGE_KEY = 'arousal-memory-enabled'
export const MEMORY_TOPK_STORAGE_KEY = 'arousal-memory-topk'
export const EMBEDDING_BASE_URL_STORAGE_KEY = 'arousal-embedding-base-url'
export const EMBEDDING_API_KEY_STORAGE_KEY = 'arousal-embedding-api-key'
export const EMBEDDING_API_KEY_ID_STORAGE_KEY = 'arousal-embedding-api-key-id'
export const EMBEDDING_MODEL_STORAGE_KEY = 'arousal-embedding-model'
export const EMBEDDING_DIMENSIONS_STORAGE_KEY = 'arousal-embedding-dimensions'
export const CHAT_FONT_SIZE_REM_STORAGE_KEY = 'arousal-chat-font-size-rem'
export const COMPOSER_ENTER_MODE_STORAGE_KEY = 'arousal-composer-enter-mode'
export const CHUNK_TURNS_PER_FILE_STORAGE_KEY = 'arousal-chunk-turns-per-file'

const DEFAULT_PROMPT_MAX_STORED = 10

function readStoredWriteChatPrompt(): boolean {
  try {
    const raw = localStorage.getItem(CHAT_PROMPT_WRITE_STORAGE_KEY)
    if (raw === '0' || raw === 'false') return false
    if (raw === '1' || raw === 'true') return true
  } catch {
    /* ignore */
  }
  return true
}

function clampPromptMaxStored(n: number): number {
  const x = Math.floor(Number(n))
  if (!Number.isFinite(x)) return DEFAULT_PROMPT_MAX_STORED
  return Math.min(200, Math.max(1, x))
}

function readStoredPromptMaxStored(): number {
  try {
    const raw = localStorage.getItem(PROMPT_DEBUG_MAX_STORED_KEY)
    if (raw == null || raw === '') return DEFAULT_PROMPT_MAX_STORED
    return clampPromptMaxStored(Number.parseInt(raw, 10))
  } catch {
    return DEFAULT_PROMPT_MAX_STORED
  }
}

function readStoredLoreRecursive(): boolean {
  try {
    const raw = localStorage.getItem(LOREBOOK_RECURSIVE_STORAGE_KEY)
    if (raw === '1' || raw === 'true') return true
    if (raw === '0' || raw === 'false') return false
  } catch {
    /* ignore */
  }
  return LOREBOOK_SETTINGS_DEFAULTS.recursiveEnabled
}

function readStoredLoreDepth(): number {
  try {
    const raw = localStorage.getItem(LOREBOOK_DEPTH_STORAGE_KEY)
    if (raw == null || raw === '') return LOREBOOK_SETTINGS_DEFAULTS.maxRecursionDepth
    return normalizeLorebookSettings({
      recursiveEnabled: true,
      maxRecursionDepth: Number.parseInt(raw, 10),
    }).maxRecursionDepth
  } catch {
    return LOREBOOK_SETTINGS_DEFAULTS.maxRecursionDepth
  }
}

function readStoredLoreVectorEnabled(): boolean {
  try {
    const raw = localStorage.getItem(LOREBOOK_VECTOR_ENABLED_STORAGE_KEY)
    if (raw === '1' || raw === 'true') return true
    if (raw === '0' || raw === 'false') return false
  } catch {
    /* ignore */
  }
  return LOREBOOK_SETTINGS_DEFAULTS.vectorEnabled
}

function readStoredLoreVectorTopK(): number {
  try {
    const raw = localStorage.getItem(LOREBOOK_VECTOR_TOPK_STORAGE_KEY)
    if (raw == null || raw === '') return LOREBOOK_SETTINGS_DEFAULTS.vectorTopK
    return normalizeLorebookSettings({
      vectorEnabled: true,
      vectorTopK: Number.parseInt(raw, 10),
    }).vectorTopK
  } catch {
    return LOREBOOK_SETTINGS_DEFAULTS.vectorTopK
  }
}

function readStoredHistoryLimitEnabled(): boolean {
  try {
    const raw = localStorage.getItem(HISTORY_LIMIT_STORAGE_KEY)
    if (raw === '1' || raw === 'true') return true
    if (raw === '0' || raw === 'false') return false
  } catch {
    /* ignore */
  }
  return HISTORY_SETTINGS_DEFAULTS.limitEnabled
}

function readStoredHistoryMaxTurns(): number {
  try {
    const raw = localStorage.getItem(HISTORY_MAX_TURNS_STORAGE_KEY)
    if (raw == null || raw === '') return HISTORY_SETTINGS_DEFAULTS.maxTurns
    return normalizeHistorySettings({
      limitEnabled: true,
      maxTurns: Number.parseInt(raw, 10),
    }).maxTurns
  } catch {
    return HISTORY_SETTINGS_DEFAULTS.maxTurns
  }
}

function readStoredMemoryEnabled(): boolean {
  try {
    const raw = localStorage.getItem(MEMORY_ENABLED_STORAGE_KEY)
    if (raw === '1' || raw === 'true') return true
    if (raw === '0' || raw === 'false') return false
  } catch {
    /* ignore */
  }
  return MEMORY_SETTINGS_DEFAULTS.memoryEnabled
}

function readStoredMemoryTopK(): number {
  try {
    const raw = localStorage.getItem(MEMORY_TOPK_STORAGE_KEY)
    if (raw == null || raw === '') return MEMORY_SETTINGS_DEFAULTS.memoryTopK
    return normalizeMemorySettings({
      memoryEnabled: true,
      memoryTopK: Number.parseInt(raw, 10),
    }).memoryTopK
  } catch {
    return MEMORY_SETTINGS_DEFAULTS.memoryTopK
  }
}

function readStoredEmbeddingBaseUrl(): string {
  try {
    const raw = localStorage.getItem(EMBEDDING_BASE_URL_STORAGE_KEY)
    if (raw?.trim()) return raw.trim()
  } catch {
    /* ignore */
  }
  return EMBEDDING_API_SETTINGS_DEFAULTS.baseUrl
}

function readStoredEmbeddingApiKey(): string {
  try {
    const raw = localStorage.getItem(EMBEDDING_API_KEY_STORAGE_KEY)
    if (typeof raw === 'string') return raw
  } catch {
    /* ignore */
  }
  return ''
}

function readStoredEmbeddingApiKeyId(): string | null {
  try {
    const raw = localStorage.getItem(EMBEDDING_API_KEY_ID_STORAGE_KEY)
    if (raw?.trim()) return raw.trim()
  } catch {
    /* ignore */
  }
  return null
}

function readStoredEmbeddingModel(): string {
  try {
    const raw = localStorage.getItem(EMBEDDING_MODEL_STORAGE_KEY)
    if (raw?.trim()) return raw.trim()
  } catch {
    /* ignore */
  }
  return EMBEDDING_API_SETTINGS_DEFAULTS.embeddingModel
}

function readStoredEmbeddingDimensions(): number | null {
  try {
    const raw = localStorage.getItem(EMBEDDING_DIMENSIONS_STORAGE_KEY)
    if (raw == null || raw === '') return null
    return normalizeEmbeddingDimensions(Number.parseInt(raw, 10))
  } catch {
    return null
  }
}

function readStoredChatFontSizeRem(): number {
  try {
    const raw = localStorage.getItem(CHAT_FONT_SIZE_REM_STORAGE_KEY)
    if (raw == null || raw === '') return CHAT_FONT_SIZE_REM_DEFAULT
    return normalizeChatFontSizeRem(Number.parseFloat(raw))
  } catch {
    return CHAT_FONT_SIZE_REM_DEFAULT
  }
}

function readStoredComposerEnterMode(): ComposerEnterMode {
  try {
    const raw = localStorage.getItem(COMPOSER_ENTER_MODE_STORAGE_KEY)
    if (raw == null || raw === '') return COMPOSER_ENTER_MODE_DEFAULT
    return normalizeComposerEnterMode(raw)
  } catch {
    return COMPOSER_ENTER_MODE_DEFAULT
  }
}

function readStoredChunkTurnsPerFile(): number {
  try {
    const raw = localStorage.getItem(CHUNK_TURNS_PER_FILE_STORAGE_KEY)
    if (raw == null || raw === '') return CHUNK_SETTINGS_DEFAULTS.turnsPerFile
    return normalizeChunkSettings({
      turnsPerFile: Number.parseInt(raw, 10),
    }).turnsPerFile
  } catch {
    return CHUNK_SETTINGS_DEFAULTS.turnsPerFile
  }
}

function persistChunkLocal(turnsPerFile: number) {
  try {
    localStorage.setItem(CHUNK_TURNS_PER_FILE_STORAGE_KEY, String(turnsPerFile))
  } catch {
    /* ignore */
  }
}

/** 应用偏好（与连接配置分离） */
export const usePreferencesStore = defineStore('preferences', () => {
  const writeChatPromptSnapshot = ref(readStoredWriteChatPrompt())
  const promptDebugMaxStored = ref(readStoredPromptMaxStored())
  const lorebookRecursiveEnabled = ref(readStoredLoreRecursive())
  const lorebookMaxRecursionDepth = ref(readStoredLoreDepth())
  const lorebookVectorEnabled = ref(readStoredLoreVectorEnabled())
  const lorebookVectorTopK = ref(readStoredLoreVectorTopK())
  const historyLimitEnabled = ref(readStoredHistoryLimitEnabled())
  const historyMaxTurns = ref(readStoredHistoryMaxTurns())
  const memoryEnabled = ref(readStoredMemoryEnabled())
  const memoryTopK = ref(readStoredMemoryTopK())
  const embeddingBaseUrl = ref(readStoredEmbeddingBaseUrl())
  const embeddingApiKey = ref('')
  const embeddingKeyConfigured = ref(false)
  const embeddingApiKeyDirty = ref(false)
  const embeddingApiKeyId = ref<string | null>(readStoredEmbeddingApiKeyId())
  const embeddingModel = ref(readStoredEmbeddingModel())
  const embeddingDimensions = ref<number | null>(readStoredEmbeddingDimensions())
  const chatFontSizeRem = ref(readStoredChatFontSizeRem())
  const composerEnterMode = ref(readStoredComposerEnterMode())
  const chunkTurnsPerFile = ref(readStoredChunkTurnsPerFile())
  const userPreferencesLoaded = ref(false)
  let lorebookPatchInFlight = false
  let historyPatchInFlight = false
  let memoryPatchInFlight = false
  let embeddingPatchInFlight = false
  let chunkPatchInFlight = false

  watch(
    writeChatPromptSnapshot,
    (v) => {
      try {
        localStorage.setItem(CHAT_PROMPT_WRITE_STORAGE_KEY, v ? '1' : '0')
      } catch {
        /* ignore */
      }
    },
    { flush: 'post' },
  )

  watch(
    promptDebugMaxStored,
    (v) => {
      const c = clampPromptMaxStored(v)
      if (c !== v) {
        promptDebugMaxStored.value = c
        return
      }
      try {
        localStorage.setItem(PROMPT_DEBUG_MAX_STORED_KEY, String(c))
      } catch {
        /* ignore */
      }
    },
    { flush: 'post' },
  )

  watch(
    chatFontSizeRem,
    (v) => {
      const n = normalizeChatFontSizeRem(v)
      if (n !== v) {
        chatFontSizeRem.value = n
        return
      }
      try {
        localStorage.setItem(CHAT_FONT_SIZE_REM_STORAGE_KEY, String(n))
      } catch {
        /* ignore */
      }
    },
    { flush: 'post' },
  )

  watch(
    composerEnterMode,
    (v) => {
      const mode = normalizeComposerEnterMode(v)
      if (mode !== v) {
        composerEnterMode.value = mode
        return
      }
      try {
        localStorage.setItem(COMPOSER_ENTER_MODE_STORAGE_KEY, mode)
      } catch {
        /* ignore */
      }
    },
    { flush: 'post' },
  )

  function persistLorebookLocal() {
    try {
      localStorage.setItem(
        LOREBOOK_RECURSIVE_STORAGE_KEY,
        lorebookRecursiveEnabled.value ? '1' : '0',
      )
      localStorage.setItem(
        LOREBOOK_DEPTH_STORAGE_KEY,
        String(lorebookMaxRecursionDepth.value),
      )
      localStorage.setItem(
        LOREBOOK_VECTOR_ENABLED_STORAGE_KEY,
        lorebookVectorEnabled.value ? '1' : '0',
      )
      localStorage.setItem(
        LOREBOOK_VECTOR_TOPK_STORAGE_KEY,
        String(lorebookVectorTopK.value),
      )
    } catch {
      /* ignore */
    }
  }

  function persistHistoryLocal() {
    try {
      localStorage.setItem(
        HISTORY_LIMIT_STORAGE_KEY,
        historyLimitEnabled.value ? '1' : '0',
      )
      localStorage.setItem(HISTORY_MAX_TURNS_STORAGE_KEY, String(historyMaxTurns.value))
    } catch {
      /* ignore */
    }
  }

  async function patchGlobalLorebookToServer(
    patch: Partial<LorebookSettings>,
  ): Promise<void> {
    const res = await fetch('/api/user-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lorebook: patch }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt.slice(0, 200))
    }
    const j = (await res.json()) as { lorebook?: Partial<LorebookSettings> }
    if (j.lorebook) {
      const n = normalizeLorebookSettings(j.lorebook)
      lorebookRecursiveEnabled.value = n.recursiveEnabled
      lorebookMaxRecursionDepth.value = n.maxRecursionDepth
      lorebookVectorEnabled.value = n.vectorEnabled
      lorebookVectorTopK.value = n.vectorTopK
      persistLorebookLocal()
    }
  }

  function persistMemoryLocal() {
    try {
      localStorage.setItem(MEMORY_ENABLED_STORAGE_KEY, memoryEnabled.value ? '1' : '0')
      localStorage.setItem(MEMORY_TOPK_STORAGE_KEY, String(memoryTopK.value))
    } catch {
      /* ignore */
    }
  }

  function persistEmbeddingLocal() {
    try {
      localStorage.setItem(EMBEDDING_BASE_URL_STORAGE_KEY, embeddingBaseUrl.value)
      localStorage.removeItem(EMBEDDING_API_KEY_STORAGE_KEY)
      if (embeddingApiKeyId.value) {
        localStorage.setItem(EMBEDDING_API_KEY_ID_STORAGE_KEY, embeddingApiKeyId.value)
      } else {
        localStorage.removeItem(EMBEDDING_API_KEY_ID_STORAGE_KEY)
      }
      localStorage.setItem(EMBEDDING_MODEL_STORAGE_KEY, embeddingModel.value)
      if (embeddingDimensions.value == null) {
        localStorage.removeItem(EMBEDDING_DIMENSIONS_STORAGE_KEY)
      } else {
        localStorage.setItem(
          EMBEDDING_DIMENSIONS_STORAGE_KEY,
          String(embeddingDimensions.value),
        )
      }
    } catch {
      /* ignore */
    }
  }

  function applyEmbeddingFromServer(raw?: Partial<EmbeddingApiSettings> & { keyConfigured?: boolean }) {
    const n = normalizeEmbeddingApiSettings(raw)
    embeddingBaseUrl.value = n.baseUrl
    embeddingApiKey.value = ''
    embeddingApiKeyDirty.value = false
    embeddingKeyConfigured.value = Boolean(raw?.keyConfigured)
    embeddingApiKeyId.value = n.apiKeyId ?? null
    embeddingModel.value = n.embeddingModel
    embeddingDimensions.value = n.embeddingDimensions
    persistEmbeddingLocal()
  }

  async function patchGlobalEmbeddingApiToServer(
    patch: Partial<EmbeddingApiSettings>,
  ): Promise<void> {
    const res = await fetch('/api/user-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeddingApi: patch }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt.slice(0, 200))
    }
    const j = (await res.json()) as { embeddingApi?: Partial<EmbeddingApiSettings> }
    if (j.embeddingApi) {
      embeddingPatchInFlight = true
      applyEmbeddingFromServer(j.embeddingApi)
      embeddingPatchInFlight = false
    }
  }

  async function patchGlobalMemoryToServer(
    patch: Partial<MemorySettings>,
  ): Promise<void> {
    const res = await fetch('/api/user-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory: patch }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt.slice(0, 200))
    }
    const j = (await res.json()) as { memory?: Partial<MemorySettings> }
    if (j.memory) {
      const n = normalizeMemorySettings(j.memory)
      memoryPatchInFlight = true
      memoryEnabled.value = n.memoryEnabled
      memoryTopK.value = n.memoryTopK
      persistMemoryLocal()
      memoryPatchInFlight = false
    }
  }

  async function patchGlobalHistoryToServer(
    patch: Partial<HistorySettings>,
  ): Promise<void> {
    const res = await fetch('/api/user-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: patch }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt.slice(0, 200))
    }
    const j = (await res.json()) as { history?: Partial<HistorySettings> }
    if (j.history) {
      const n = normalizeHistorySettings(j.history)
      historyPatchInFlight = true
      historyLimitEnabled.value = n.limitEnabled
      historyMaxTurns.value = n.maxTurns
      persistHistoryLocal()
      historyPatchInFlight = false
    }
  }

  async function patchGlobalChunkToServer(
    patch: Partial<ChunkSettings>,
  ): Promise<void> {
    const res = await fetch('/api/user-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunk: patch }),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt.slice(0, 200))
    }
    const j = (await res.json()) as { chunk?: Partial<ChunkSettings> }
    if (j.chunk) {
      const n = normalizeChunkSettings(j.chunk)
      chunkPatchInFlight = true
      chunkTurnsPerFile.value = n.turnsPerFile
      persistChunkLocal(n.turnsPerFile)
      chunkPatchInFlight = false
    }
  }

  watch(
    chunkTurnsPerFile,
    async () => {
      if (!userPreferencesLoaded.value || chunkPatchInFlight) return
      const n = normalizeChunkSettings({
        turnsPerFile: chunkTurnsPerFile.value,
      })
      if (n.turnsPerFile !== chunkTurnsPerFile.value) {
        chunkTurnsPerFile.value = n.turnsPerFile
        return
      }
      persistChunkLocal(n.turnsPerFile)
      chunkPatchInFlight = true
      try {
        await patchGlobalChunkToServer({ turnsPerFile: n.turnsPerFile })
      } catch {
        /* 设置页可重试 */
      } finally {
        chunkPatchInFlight = false
      }
    },
    { flush: 'post' },
  )

  watch(
    [lorebookRecursiveEnabled, lorebookMaxRecursionDepth, lorebookVectorEnabled, lorebookVectorTopK],
    async () => {
      if (!userPreferencesLoaded.value || lorebookPatchInFlight) return
      const n = normalizeLorebookSettings({
        recursiveEnabled: lorebookRecursiveEnabled.value,
        maxRecursionDepth: lorebookMaxRecursionDepth.value,
        vectorEnabled: lorebookVectorEnabled.value,
        vectorTopK: lorebookVectorTopK.value,
      })
      if (n.vectorTopK !== lorebookVectorTopK.value) {
        lorebookVectorTopK.value = n.vectorTopK
        return
      }
      persistLorebookLocal()
      lorebookPatchInFlight = true
      try {
        await patchGlobalLorebookToServer({
          recursiveEnabled: lorebookRecursiveEnabled.value,
          maxRecursionDepth: lorebookMaxRecursionDepth.value,
          vectorEnabled: lorebookVectorEnabled.value,
          vectorTopK: lorebookVectorTopK.value,
        })
      } catch {
        /* 设置页可重试 */
      } finally {
        lorebookPatchInFlight = false
      }
    },
    { flush: 'post' },
  )

  watch(
    [historyLimitEnabled, historyMaxTurns],
    async () => {
      if (!userPreferencesLoaded.value || historyPatchInFlight) return
      const n = normalizeHistorySettings({
        limitEnabled: historyLimitEnabled.value,
        maxTurns: historyMaxTurns.value,
      })
      if (n.maxTurns !== historyMaxTurns.value) {
        historyMaxTurns.value = n.maxTurns
        return
      }
      persistHistoryLocal()
      historyPatchInFlight = true
      try {
        await patchGlobalHistoryToServer({
          limitEnabled: historyLimitEnabled.value,
          maxTurns: historyMaxTurns.value,
        })
      } catch {
        /* 设置页可重试 */
      } finally {
        historyPatchInFlight = false
      }
    },
    { flush: 'post' },
  )

  watch(
    [memoryEnabled, memoryTopK],
    async () => {
      if (!userPreferencesLoaded.value || memoryPatchInFlight) return
      const n = normalizeMemorySettings({
        memoryEnabled: memoryEnabled.value,
        memoryTopK: memoryTopK.value,
      })
      if (n.memoryTopK !== memoryTopK.value) {
        memoryTopK.value = n.memoryTopK
        return
      }
      persistMemoryLocal()
      memoryPatchInFlight = true
      try {
        await patchGlobalMemoryToServer({
          memoryEnabled: memoryEnabled.value,
          memoryTopK: memoryTopK.value,
        })
      } catch {
        /* 设置页可重试 */
      } finally {
        memoryPatchInFlight = false
      }
    },
    { flush: 'post' },
  )

  watch(
    [embeddingBaseUrl, embeddingApiKey, embeddingApiKeyId, embeddingModel, embeddingDimensions],
    async () => {
      if (!userPreferencesLoaded.value || embeddingPatchInFlight) return
      const n = normalizeEmbeddingApiSettings({
        baseUrl: embeddingBaseUrl.value,
        apiKey: embeddingApiKey.value,
        apiKeyId: embeddingApiKeyId.value,
        embeddingModel: embeddingModel.value,
        embeddingDimensions: embeddingDimensions.value,
      })
      if (n.embeddingDimensions !== embeddingDimensions.value) {
        embeddingDimensions.value = n.embeddingDimensions
        return
      }
      persistEmbeddingLocal()
      embeddingPatchInFlight = true
      try {
        const patch: Partial<EmbeddingApiSettings> = {
          baseUrl: n.baseUrl,
          apiKeyId: embeddingApiKeyId.value,
          embeddingModel: n.embeddingModel,
          embeddingDimensions: n.embeddingDimensions,
        }
        if (embeddingApiKeyDirty.value && !embeddingApiKeyId.value) {
          patch.apiKey = embeddingApiKey.value
        }
        await patchGlobalEmbeddingApiToServer(patch)
        if (embeddingApiKeyDirty.value) {
          embeddingKeyConfigured.value = embeddingApiKey.value.trim().length > 0
          embeddingApiKey.value = ''
          embeddingApiKeyDirty.value = false
        }
      } catch {
        /* 设置页可重试 */
      } finally {
        embeddingPatchInFlight = false
      }
    },
    { flush: 'post' },
  )

  let loadPrefsInflight: Promise<void> | null = null

  function resetUserPreferencesLoadState(): void {
    userPreferencesLoaded.value = false
    loadPrefsInflight = null
  }

  async function loadUserPreferencesFromServer(): Promise<void> {
    if (userPreferencesLoaded.value) return
    if (!loadPrefsInflight) {
      loadPrefsInflight = (async () => {
      try {
        const res = await fetch('/api/user-preferences')
        if (!res.ok) return
        const doc = (await res.json()) as {
          lorebook?: Partial<LorebookSettings>
          history?: Partial<HistorySettings>
          memory?: Partial<MemorySettings>
          embeddingApi?: Partial<EmbeddingApiSettings>
          chunk?: Partial<ChunkSettings>
        }
        lorebookPatchInFlight = true
        historyPatchInFlight = true
        memoryPatchInFlight = true
        embeddingPatchInFlight = true
        chunkPatchInFlight = true
        const lore = normalizeLorebookSettings(doc.lorebook)
        lorebookRecursiveEnabled.value = lore.recursiveEnabled
        lorebookMaxRecursionDepth.value = lore.maxRecursionDepth
        lorebookVectorEnabled.value = lore.vectorEnabled
        lorebookVectorTopK.value = lore.vectorTopK
        persistLorebookLocal()
        const hist = normalizeHistorySettings(doc.history)
        historyLimitEnabled.value = hist.limitEnabled
        historyMaxTurns.value = hist.maxTurns
        persistHistoryLocal()
        const mem = normalizeMemorySettings(doc.memory)
        memoryEnabled.value = mem.memoryEnabled
        memoryTopK.value = mem.memoryTopK
        persistMemoryLocal()
        applyEmbeddingFromServer(doc.embeddingApi)
        const chunk = normalizeChunkSettings(doc.chunk)
        chunkTurnsPerFile.value = chunk.turnsPerFile
        persistChunkLocal(chunk.turnsPerFile)
      } catch {
        /* 使用 localStorage 缓存 */
      } finally {
        lorebookPatchInFlight = false
        historyPatchInFlight = false
        memoryPatchInFlight = false
        embeddingPatchInFlight = false
        chunkPatchInFlight = false
        userPreferencesLoaded.value = true
        loadPrefsInflight = null
      }
      })()
    }
    return loadPrefsInflight
  }

  function setWriteChatPromptSnapshot(v: boolean) {
    writeChatPromptSnapshot.value = v
  }

  function setPromptDebugMaxStored(n: number) {
    promptDebugMaxStored.value = clampPromptMaxStored(n)
  }

  function setLorebookRecursiveEnabled(v: boolean) {
    lorebookRecursiveEnabled.value = v
  }

  function setLorebookMaxRecursionDepth(n: number) {
    lorebookMaxRecursionDepth.value = normalizeLorebookSettings({
      recursiveEnabled: true,
      maxRecursionDepth: n,
    }).maxRecursionDepth
  }

  function setLorebookVectorEnabled(v: boolean) {
    lorebookVectorEnabled.value = v
  }

  function setLorebookVectorTopK(n: number) {
    lorebookVectorTopK.value = normalizeLorebookSettings({
      vectorEnabled: true,
      vectorTopK: n,
    }).vectorTopK
  }

  function setHistoryLimitEnabled(v: boolean) {
    historyLimitEnabled.value = v
  }

  function setHistoryMaxTurns(n: number) {
    historyMaxTurns.value = normalizeHistorySettings({
      limitEnabled: true,
      maxTurns: n,
    }).maxTurns
  }

  function setMemoryEnabled(v: boolean) {
    memoryEnabled.value = v
  }

  function setMemoryTopK(n: number) {
    memoryTopK.value = normalizeMemorySettings({
      memoryEnabled: true,
      memoryTopK: n,
    }).memoryTopK
  }

  function setEmbeddingApiKeyId(id: string | null) {
    embeddingApiKeyId.value = id
    embeddingApiKey.value = ''
    embeddingApiKeyDirty.value = false
  }

  function markEmbeddingApiKeyDirty() {
    embeddingApiKeyDirty.value = true
  }

  const isEmbeddingKeyConfigured = computed(() => {
    if (embeddingApiKeyDirty.value && embeddingApiKey.value.trim()) return true
    if (embeddingKeyConfigured.value) return true
    if (embeddingApiKeyId.value) {
      const keychain = useApiKeysStore()
      const entry = keychain.findById(embeddingApiKeyId.value)
      if (entry?.keyConfigured) return true
    }
    return false
  })

  function setEmbeddingDimensions(n: number | null) {
    embeddingDimensions.value = normalizeEmbeddingDimensions(n)
  }

  function setChatFontSizeRem(n: number) {
    chatFontSizeRem.value = normalizeChatFontSizeRem(n)
  }

  function setChunkTurnsPerFile(n: number) {
    chunkTurnsPerFile.value = normalizeChunkSettings({
      turnsPerFile: n,
    }).turnsPerFile
  }

  return {
    writeChatPromptSnapshot,
    setWriteChatPromptSnapshot,
    promptDebugMaxStored,
    setPromptDebugMaxStored,
    lorebookRecursiveEnabled,
    lorebookMaxRecursionDepth,
    setLorebookRecursiveEnabled,
    setLorebookMaxRecursionDepth,
    lorebookVectorEnabled,
    lorebookVectorTopK,
    setLorebookVectorEnabled,
    setLorebookVectorTopK,
    historyLimitEnabled,
    historyMaxTurns,
    setHistoryLimitEnabled,
    setHistoryMaxTurns,
    memoryEnabled,
    memoryTopK,
    setMemoryEnabled,
    setMemoryTopK,
    embeddingBaseUrl,
    embeddingApiKey,
    embeddingApiKeyId,
    embeddingKeyConfigured,
    embeddingApiKeyDirty,
    isEmbeddingKeyConfigured,
    markEmbeddingApiKeyDirty,
    embeddingModel,
    setEmbeddingApiKeyId,
    embeddingDimensions,
    setEmbeddingDimensions,
    chatFontSizeRem,
    setChatFontSizeRem,
    composerEnterMode,
    chunkTurnsPerFile,
    setChunkTurnsPerFile,
    userPreferencesLoaded,
    resetUserPreferencesLoadState,
    loadUserPreferencesFromServer,
  }
})
