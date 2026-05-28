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
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const CHAT_PROMPT_WRITE_STORAGE_KEY = 'arousal-chat-write-prompt-snapshot'
export const PROMPT_DEBUG_MAX_STORED_KEY = 'arousal-chat-prompt-debug-max-stored'
export const LOREBOOK_RECURSIVE_STORAGE_KEY = 'arousal-lorebook-recursive-enabled'
export const LOREBOOK_DEPTH_STORAGE_KEY = 'arousal-lorebook-max-recursion-depth'
export const HISTORY_LIMIT_STORAGE_KEY = 'arousal-history-limit-enabled'
export const HISTORY_MAX_TURNS_STORAGE_KEY = 'arousal-history-max-turns'

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

/** 应用偏好（与连接配置分离） */
export const usePreferencesStore = defineStore('preferences', () => {
  const writeChatPromptSnapshot = ref(readStoredWriteChatPrompt())
  const promptDebugMaxStored = ref(readStoredPromptMaxStored())
  const lorebookRecursiveEnabled = ref(readStoredLoreRecursive())
  const lorebookMaxRecursionDepth = ref(readStoredLoreDepth())
  const historyLimitEnabled = ref(readStoredHistoryLimitEnabled())
  const historyMaxTurns = ref(readStoredHistoryMaxTurns())
  const userPreferencesLoaded = ref(false)
  let lorebookPatchInFlight = false
  let historyPatchInFlight = false

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
      persistLorebookLocal()
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

  watch(
    [lorebookRecursiveEnabled, lorebookMaxRecursionDepth],
    async () => {
      if (!userPreferencesLoaded.value || lorebookPatchInFlight) return
      persistLorebookLocal()
      lorebookPatchInFlight = true
      try {
        await patchGlobalLorebookToServer({
          recursiveEnabled: lorebookRecursiveEnabled.value,
          maxRecursionDepth: lorebookMaxRecursionDepth.value,
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

  let loadPrefsInflight: Promise<void> | null = null

  async function loadUserPreferencesFromServer(): Promise<void> {
    if (userPreferencesLoaded.value) return
    if (loadPrefsInflight) return loadPrefsInflight
    loadPrefsInflight = (async () => {
      try {
        const res = await fetch('/api/user-preferences')
        if (!res.ok) return
        const doc = (await res.json()) as {
          lorebook?: Partial<LorebookSettings>
          history?: Partial<HistorySettings>
        }
        lorebookPatchInFlight = true
        historyPatchInFlight = true
        const lore = normalizeLorebookSettings(doc.lorebook)
        lorebookRecursiveEnabled.value = lore.recursiveEnabled
        lorebookMaxRecursionDepth.value = lore.maxRecursionDepth
        persistLorebookLocal()
        const hist = normalizeHistorySettings(doc.history)
        historyLimitEnabled.value = hist.limitEnabled
        historyMaxTurns.value = hist.maxTurns
        persistHistoryLocal()
      } catch {
        /* 使用 localStorage 缓存 */
      } finally {
        lorebookPatchInFlight = false
        historyPatchInFlight = false
        userPreferencesLoaded.value = true
      }
    })().finally(() => {
      loadPrefsInflight = null
    })
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

  function setHistoryLimitEnabled(v: boolean) {
    historyLimitEnabled.value = v
  }

  function setHistoryMaxTurns(n: number) {
    historyMaxTurns.value = normalizeHistorySettings({
      limitEnabled: true,
      maxTurns: n,
    }).maxTurns
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
    historyLimitEnabled,
    historyMaxTurns,
    setHistoryLimitEnabled,
    setHistoryMaxTurns,
    userPreferencesLoaded,
    loadUserPreferencesFromServer,
  }
})
