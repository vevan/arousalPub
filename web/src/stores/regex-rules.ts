import { useRegexRulesDisplayStore } from '@/stores/regex-rules-display'
import type { RegexRule } from '@/types/regex-rules'
import {
  allRegexRulesSaveReady,
  assignOrdersInListOrder,
  buildRulesForServerPut,
  cloneRegexRules,
  createDefaultRegexRule,
  documentFromRules,
  mergeSavedRulesWithLocalDrafts,
  normalizeRegexRulesFromServer,
  regexRulesEqual,
  sortRegexRules,
} from '@/utils/regex-rules'
import { invalidateRegexHostRulesCache } from '@/plugins/plugin-host-regex'
import { apiErrorFromResponseBody } from '@/utils/api-error-message'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const SAVE_DEBOUNCE_MS = 600

export const useRegexRulesStore = defineStore('regexRules', () => {
  const rules = ref<RegexRule[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const lastError = ref<string | null>(null)
  const lastSavedAt = ref<string | null>(null)
  const selectedRuleId = ref<string | null>(null)

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSave = false
  let lastSyncedRules: RegexRule[] = []

  const sortedRules = computed(() => sortRegexRules(rules.value))

  const selectedRule = computed(() => {
    if (!selectedRuleId.value) return null
    return rules.value.find((r) => r.id === selectedRuleId.value) ?? null
  })

  function syncLastSynced(): void {
    lastSyncedRules = cloneRegexRules(rules.value)
  }

  function applyRules(next: RegexRule[]): void {
    rules.value = cloneRegexRules(next)
  }

  async function putRulesToServer(
    nextRules: RegexRule[],
    localOverlay?: RegexRule[],
  ): Promise<void> {
    const ordered = assignOrdersInListOrder(nextRules)
    if (!allRegexRulesSaveReady(ordered)) {
      throw new Error('regex_rules_validation_failed')
    }
    const payload = documentFromRules(ordered)
    if (regexRulesEqual(payload.rules, lastSyncedRules)) return

    saving.value = true
    lastError.value = null
    try {
      const res = await fetch('/api/regex-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: payload.rules }),
      })
      if (!res.ok) {
        let msg = `PUT /api/regex-rules ${res.status}`
        try {
          const j = await res.json()
          msg = apiErrorFromResponseBody(j, 'regex_rules_write_failed')
        } catch {
          /*  */
        }
        throw new Error(msg)
      }
      const doc = (await res.json()) as { rules?: RegexRule[]; savedAt?: string }
      if (Array.isArray(doc.rules)) {
        applyRules(
          normalizeRegexRulesFromServer(
            localOverlay
              ? mergeSavedRulesWithLocalDrafts(doc.rules, localOverlay)
              : doc.rules,
          ),
        )
        if (
          selectedRuleId.value &&
          !rules.value.some((r) => r.id === selectedRuleId.value)
        ) {
          selectedRuleId.value = rules.value[0]?.id ?? null
        }
      } else {
        applyRules(localOverlay ?? ordered)
      }
      if (typeof doc.savedAt === 'string') lastSavedAt.value = doc.savedAt
      syncLastSynced()
      useRegexRulesDisplayStore().syncRules(rules.value)
      invalidateRegexHostRulesCache()
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      saving.value = false
    }
  }

  /** 立即写盘（拖曳排序 / 开关，对齐插件 registry PUT） */
  async function persistRulesList(nextRules: RegexRule[]): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    pendingSave = false
    const localOrdered = assignOrdersInListOrder(nextRules)
    applyRules(localOrdered)

    const serverPayload = buildRulesForServerPut(localOrdered, lastSyncedRules)
    if (serverPayload.length === 0) {
      if (localOrdered.length > 0) return
      await putRulesToServer(serverPayload, localOrdered)
      return
    }
    if (!allRegexRulesSaveReady(serverPayload)) {
      throw new Error('regex_rules_validation_failed')
    }
    await putRulesToServer(serverPayload, localOrdered)
  }

  function scheduleSave(): void {
    if (!loaded.value) return
    pendingSave = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushSave()
    }, SAVE_DEBOUNCE_MS)
  }

  async function flushSave(): Promise<void> {
    if (!pendingSave) return
    pendingSave = false
    if (!allRegexRulesSaveReady(rules.value)) return
    try {
      await putRulesToServer(rules.value)
    } catch {
      pendingSave = true
    }
  }

  async function loadFromServer(force = false): Promise<void> {
    if (loaded.value && !force) return
    loading.value = true
    lastError.value = null
    try {
      const res = await fetch('/api/regex-rules')
      if (!res.ok) {
        throw new Error(
          apiErrorFromResponseBody(await res.json().catch(() => null), 'regex_rules_read_failed'),
        )
      }
      const doc = (await res.json()) as { rules?: RegexRule[]; savedAt?: string }
      applyRules(
        normalizeRegexRulesFromServer(Array.isArray(doc.rules) ? doc.rules : []),
      )
      if (typeof doc.savedAt === 'string') lastSavedAt.value = doc.savedAt
      if (
        selectedRuleId.value &&
        !rules.value.some((r) => r.id === selectedRuleId.value)
      ) {
        selectedRuleId.value = rules.value[0]?.id ?? null
      }
      syncLastSynced()
      loaded.value = true
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  function selectRule(id: string | null): void {
    selectedRuleId.value = id
  }

  function createRuleDraft(): RegexRule {
    return createDefaultRegexRule(rules.value)
  }

  function addRule(): void {
    const rule = createDefaultRegexRule(rules.value)
    rules.value = [...rules.value, rule]
    selectedRuleId.value = rule.id
  }

  function deleteRule(id: string): void {
    rules.value = rules.value.filter((r) => r.id !== id)
    if (selectedRuleId.value === id) {
      selectedRuleId.value = rules.value[0]?.id ?? null
    }
  }

  function patchRule(id: string, patch: Partial<RegexRule>): void {
    const idx = rules.value.findIndex((r) => r.id === id)
    if (idx < 0) return
    const next = cloneRegexRules(rules.value)
    next[idx] = { ...next[idx], ...patch }
    if (patch.phases) next[idx].phases = [...patch.phases]
    if (patch.fields) next[idx].fields = [...patch.fields]
    rules.value = next
  }

  function clearSessionData(): void {
    rules.value = []
    loaded.value = false
    loading.value = false
    saving.value = false
    lastError.value = null
    lastSavedAt.value = null
    selectedRuleId.value = null
  }

  return {
    rules,
    sortedRules,
    loaded,
    loading,
    saving,
    lastError,
    lastSavedAt,
    selectedRuleId,
    selectedRule,
    loadFromServer,
    clearSessionData,
    flushSave,
    persistRulesList,
    scheduleSave,
    selectRule,
    createRuleDraft,
    addRule,
    deleteRule,
    patchRule,
  }
})
