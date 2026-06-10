import type { RegexRulesDocument } from '@/types/regex-rules'
import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 用户级 regex 规则；进会话拉取，供 display 渲染链使用 */
export const useRegexRulesDisplayStore = defineStore('regexRulesDisplay', () => {
  const rules = ref<RegexRulesDocument['rules']>([])
  const loadedForUserId = ref<string | null>(null)
  let inflight: Promise<void> | null = null
  let inflightUserId: string | null = null

  async function fetchRules(userId: string): Promise<void> {
    const res = await fetch('/api/regex-rules')
    if (!res.ok) {
      rules.value = []
      loadedForUserId.value = userId
      return
    }
    const doc = (await res.json()) as RegexRulesDocument
    rules.value = Array.isArray(doc.rules) ? doc.rules : []
    loadedForUserId.value = userId
  }

  /** 同用户只拉一次；切换用户或 invalidate 后重拉 */
  async function ensureLoaded(userId: string): Promise<void> {
    const uid = userId.trim()
    if (!uid) return
    if (loadedForUserId.value === uid && !inflight) return
    if (inflight && inflightUserId === uid) {
      await inflight
      return
    }
    inflightUserId = uid
    inflight = fetchRules(uid).finally(() => {
      inflight = null
      inflightUserId = null
    })
    await inflight
  }

  function invalidate(): void {
    loadedForUserId.value = null
    rules.value = []
    inflight = null
    inflightUserId = null
  }

  return {
    rules,
    loadedForUserId,
    ensureLoaded,
    invalidate,
  }
})
