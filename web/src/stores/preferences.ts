import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const CHAT_PROMPT_WRITE_STORAGE_KEY = 'arousal-chat-write-prompt-snapshot'
export const PROMPT_DEBUG_MAX_STORED_KEY = 'arousal-chat-prompt-debug-max-stored'

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

/** 应用偏好（与连接配置分离） */
export const usePreferencesStore = defineStore('preferences', () => {
  const writeChatPromptSnapshot = ref(readStoredWriteChatPrompt())
  const promptDebugMaxStored = ref(readStoredPromptMaxStored())

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

  function setWriteChatPromptSnapshot(v: boolean) {
    writeChatPromptSnapshot.value = v
  }

  function setPromptDebugMaxStored(n: number) {
    promptDebugMaxStored.value = clampPromptMaxStored(n)
  }

  return {
    writeChatPromptSnapshot,
    setWriteChatPromptSnapshot,
    promptDebugMaxStored,
    setPromptDebugMaxStored,
  }
})
