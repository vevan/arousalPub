import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { usePromptsStore, type PromptPreset } from '@/stores/prompts'
import { useApiKeysStore } from '@/stores/apiKeys'
import {
  API_PRESET_EXPORT_SCHEMA,
  type ApiPresetExportDoc,
  isPromptPresetLike,
} from '@/utils/api-preset-export'
import { translateApiError } from '@/utils/api-error-message'
import type { ApiConfigReference } from '@/utils/api-config-references'
import {
  type DrySamplerFields,
  migrateLegacyDryField,
  normalizeDrySequenceBreakers,
} from '@/utils/dry-sampler'
import { allocateShortId } from '@/utils/short-id'

export interface ApiSettingsSnapshot {
  alias: string
  baseUrl: string
  apiKey: string
  model: string
  contextLength: number | null
  maxTokens: number | null
  stream: boolean
  temperature: number | null
  topP: number | null
  topK: number | null
  dryMultiplier: number | null
  dryBase: number | null
  dryAllowedLength: number | null
  dryPenaltyLastN: number | null
  drySequenceBreakers: string[]
  frequencyPenalty: number | null
  presencePenalty: number | null
  customParamsJson: string
  showReasoningChain: boolean
  requestReasoningChain: boolean
}

export interface ApiPreset extends ApiSettingsSnapshot {
  id: string
  /** 切换到此 API 预设时自动选中的提示词预设 id；null 表示不关联 */
  linkedPromptPresetId?: string | null
  /** 引用的 API Key 别名条目 id；null/缺省表示直接使用 apiKey 字段 */
  apiKeyId?: string | null
  /** GET /api/settings 返回：服务端是否已配置密钥 */
  keyConfigured?: boolean
}

export interface ApiSettingsDocument {
  version: 1
  savedAt: string
  activePresetId: string
  presets: ApiPreset[]
}

function collectUsedApiPresetIds(list: ApiPreset[]): Set<string> {
  return new Set(list.map((p) => p.id))
}

function defaultDryFields(): DrySamplerFields {
  return {
    dryMultiplier: null,
    dryBase: null,
    dryAllowedLength: null,
    dryPenaltyLastN: null,
    drySequenceBreakers: [],
  }
}

function defaultPresetFields(): ApiSettingsSnapshot {
  return {
    alias: '默认',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    contextLength: null,
    maxTokens: null,
    stream: false,
    temperature: 0.7,
    topP: null,
    topK: null,
    ...defaultDryFields(),
    frequencyPenalty: null,
    presencePenalty: null,
    customParamsJson: '',
    showReasoningChain: true,
    requestReasoningChain: false,
  }
}

function normalizePreset(p: ApiPreset): ApiPreset {
  const legacy = migrateLegacyDryField(p as unknown as Record<string, unknown>)
  const raw = { ...p, ...legacy } as ApiPreset & { dry?: number }
  const { dry: _legacyDry, ...rest } = raw
  const link =
    typeof p.linkedPromptPresetId === 'string' && p.linkedPromptPresetId.trim()
      ? p.linkedPromptPresetId.trim()
      : null
  const keyId =
    typeof p.apiKeyId === 'string' && p.apiKeyId.trim()
      ? p.apiKeyId.trim()
      : null
  return {
    ...rest,
    drySequenceBreakers: normalizeDrySequenceBreakers(rest.drySequenceBreakers),
    linkedPromptPresetId: link,
    apiKeyId: keyId,
    showReasoningChain:
      typeof p.showReasoningChain === 'boolean' ? p.showReasoningChain : true,
    requestReasoningChain:
      typeof p.requestReasoningChain === 'boolean'
        ? p.requestReasoningChain
        : false,
    keyConfigured: Boolean(p.keyConfigured),
  }
}

export const useConnectionStore = defineStore('connection', () => {
  const presets = ref<ApiPreset[]>([])
  const activePresetId = ref<string | null>(null)

  const alias = ref('')
  const baseUrl = ref('https://api.openai.com/v1')
  const apiKey = ref('')
  const model = ref('gpt-4o-mini')

  const contextLength = ref<number | null>(null)
  const maxTokens = ref<number | null>(null)
  const stream = ref(false)
  const temperature = ref<number | null>(0.7)
  const topP = ref<number | null>(null)
  const topK = ref<number | null>(null)
  const dryMultiplier = ref<number | null>(null)
  const dryBase = ref<number | null>(null)
  const dryAllowedLength = ref<number | null>(null)
  const dryPenaltyLastN = ref<number | null>(null)
  const drySequenceBreakers = ref<string[]>([])
  const frequencyPenalty = ref<number | null>(null)
  const presencePenalty = ref<number | null>(null)
  const customParamsJson = ref('')
  const showReasoningChain = ref(true)
  const requestReasoningChain = ref(false)
  /** 当前 API 预设关联的提示词预设（写入当前 presets[i].linkedPromptPresetId） */
  const linkedPromptPresetId = ref<string | null>(null)
  /**
   * 当前 API 预设引用的 API Key 别名 id；
   * - 非空：apiKey 字段由 keychain 同步，写表单 apiKey 也会回写到 keychain
   * - 空：使用临时直接键入的 apiKey（直存预设）
   */
  const apiKeyId = ref<string | null>(null)
  /** 当前表单 apiKey 相对服务端的改动；undefined = 未改 */
  const apiKeyDraftDirty = ref(false)

  const lastSavedAt = ref<string | null>(null)

  const isApiKeyConfigured = computed(() => {
    if (apiKeyDraftDirty.value && apiKey.value.trim()) return true
    const id = activePresetId.value
    const p = id ? presets.value.find((x) => x.id === id) : null
    if (p?.keyConfigured) return true
    if (apiKeyId.value) {
      const keychain = useApiKeysStore()
      const entry = keychain.findById(apiKeyId.value)
      if (entry?.keyConfigured) return true
    }
    return false
  })

  const presetSelectItems = computed(() =>
    presets.value.map((p) => ({
      title: presetTitle(p),
      value: p.id,
    })),
  )

  function presetTitle(p: ApiPreset): string {
    const a = p.alias.trim()
    if (a) return a
    const m = p.model.trim()
    if (m) return m
    return p.id.slice(0, 8)
  }

  function snapshot(): ApiSettingsSnapshot {
    return {
      alias: alias.value,
      baseUrl: baseUrl.value,
      apiKey: apiKey.value,
      model: model.value,
      contextLength: contextLength.value,
      maxTokens: maxTokens.value,
      stream: stream.value,
      temperature: temperature.value,
      topP: topP.value,
      topK: topK.value,
      dryMultiplier: dryMultiplier.value,
      dryBase: dryBase.value,
      dryAllowedLength: dryAllowedLength.value,
      dryPenaltyLastN: dryPenaltyLastN.value,
      drySequenceBreakers: [...drySequenceBreakers.value],
      frequencyPenalty: frequencyPenalty.value,
      presencePenalty: presencePenalty.value,
      customParamsJson: customParamsJson.value,
      showReasoningChain: showReasoningChain.value,
      requestReasoningChain: requestReasoningChain.value,
    }
  }

  function applySnapshot(o: Partial<ApiSettingsSnapshot>) {
    if (typeof o.alias === 'string') alias.value = o.alias
    if (typeof o.baseUrl === 'string') baseUrl.value = o.baseUrl
    if (typeof o.apiKey === 'string') apiKey.value = o.apiKey
    if (typeof o.model === 'string') model.value = o.model
    if (o.contextLength === null || typeof o.contextLength === 'number') {
      contextLength.value = o.contextLength ?? null
    }
    if (o.maxTokens === null || typeof o.maxTokens === 'number') {
      maxTokens.value = o.maxTokens ?? null
    }
    if (typeof o.stream === 'boolean') stream.value = o.stream
    if (o.temperature === null || typeof o.temperature === 'number') {
      temperature.value = o.temperature ?? null
    }
    if (o.topP === null || typeof o.topP === 'number') topP.value = o.topP ?? null
    if (o.topK === null || typeof o.topK === 'number') topK.value = o.topK ?? null
    if (o.dryMultiplier === null || typeof o.dryMultiplier === 'number') {
      dryMultiplier.value = o.dryMultiplier ?? null
    }
    if (o.dryBase === null || typeof o.dryBase === 'number') {
      dryBase.value = o.dryBase ?? null
    }
    if (o.dryAllowedLength === null || typeof o.dryAllowedLength === 'number') {
      dryAllowedLength.value = o.dryAllowedLength ?? null
    }
    if (o.dryPenaltyLastN === null || typeof o.dryPenaltyLastN === 'number') {
      dryPenaltyLastN.value = o.dryPenaltyLastN ?? null
    }
    if (Array.isArray(o.drySequenceBreakers)) {
      drySequenceBreakers.value = normalizeDrySequenceBreakers(o.drySequenceBreakers)
    }
    const legacyDry = migrateLegacyDryField(o as Record<string, unknown>)
    if (
      legacyDry.dryMultiplier !== undefined &&
      dryMultiplier.value === null
    ) {
      dryMultiplier.value = legacyDry.dryMultiplier ?? null
    }
    if (o.frequencyPenalty === null || typeof o.frequencyPenalty === 'number') {
      frequencyPenalty.value = o.frequencyPenalty ?? null
    }
    if (o.presencePenalty === null || typeof o.presencePenalty === 'number') {
      presencePenalty.value = o.presencePenalty ?? null
    }
    if (typeof o.customParamsJson === 'string') customParamsJson.value = o.customParamsJson
    if (typeof o.showReasoningChain === 'boolean') {
      showReasoningChain.value = o.showReasoningChain
    }
    if (typeof o.requestReasoningChain === 'boolean') {
      requestReasoningChain.value = o.requestReasoningChain
    }
  }

  function applyPresetToForm(p: ApiPreset) {
    applySnapshot({ ...p, apiKey: '' })
    apiKeyDraftDirty.value = false
    linkedPromptPresetId.value = p.linkedPromptPresetId ?? null
    apiKeyId.value = p.apiKeyId ?? null
  }

  /** 将当前表单写回当前激活的预设条目 */
  function syncFormToActivePreset() {
    const id = activePresetId.value
    if (!id) return
    const i = presets.value.findIndex((p) => p.id === id)
    if (i < 0) return
    const kid =
      typeof apiKeyId.value === 'string' && apiKeyId.value
        ? apiKeyId.value
        : null
    const snap = snapshot()
    const prev = presets.value[i]
    const nextPreset: ApiPreset = {
      id,
      ...snap,
      apiKey: '',
      linkedPromptPresetId:
        linkedPromptPresetId.value == null ||
        linkedPromptPresetId.value === ''
          ? null
          : String(linkedPromptPresetId.value),
      apiKeyId: kid,
      keyConfigured: apiKeyDraftDirty.value
        ? snap.apiKey.trim().length > 0
        : (prev.keyConfigured ?? false),
    }
    presets.value[i] = nextPreset
  }

  function applyActivePresetToForm() {
    const id = activePresetId.value
    if (!id) return
    const p = presets.value.find((x) => x.id === id)
    if (p) applyPresetToForm(p)
  }

  /** 若该 API 预设配置了关联提示词预设，则切换全局激活的提示词预设 */
  async function applyLinkedPromptPresetForApiPreset(apiPresetId: string) {
    const prompts = usePromptsStore()
    const apiP = presets.value.find((x) => x.id === apiPresetId)
    const raw = apiP?.linkedPromptPresetId
    if (typeof raw !== 'string' || !raw.trim()) return
    const link = raw.trim()
    if (!prompts.loaded) {
      await prompts.loadIndexFromServer()
    }
    if (prompts.indexEntries.some((p) => p.id === link)) {
      await prompts.setActivePresetId(link, { persist: true })
    }
  }

  function switchPreset(newId: string) {
    if (newId === activePresetId.value) return
    syncFormToActivePreset()
    activePresetId.value = newId
    applyActivePresetToForm()
    void applyLinkedPromptPresetForApiPreset(newId)
  }

  /** 切换当前预设引用的 API Key 别名 id；null 代表使用预设内联 apiKey */
  function setApiKeyId(id: string | null) {
    apiKeyId.value = id
    apiKey.value = ''
    apiKeyDraftDirty.value = false
    syncFormToActivePreset()
  }

  function markApiKeyDraftDirty() {
    apiKeyDraftDirty.value = true
  }

  function addPreset() {
    syncFormToActivePreset()
    const id = allocateShortId(collectUsedApiPresetIds(presets.value))
    const p: ApiPreset = {
      id,
      ...defaultPresetFields(),
      alias: `预设 ${presets.value.length + 1}`,
      linkedPromptPresetId: null,
      apiKeyId: null,
    }
    presets.value.push(p)
    activePresetId.value = id
    applyPresetToForm(p)
  }

  function removeActivePreset(): Promise<{
    ok: true
  } | {
    ok: false
    error: string
    references?: ApiConfigReference[]
  }> {
    return removePresetById(activePresetId.value)
  }

  async function removePresetById(
    id: string | null | undefined,
  ): Promise<
    | { ok: true }
    | { ok: false; error: string; references?: ApiConfigReference[] }
  > {
    if (presets.value.length <= 1) {
      return { ok: false, error: translateApiError('api_preset_last_one') }
    }
    syncFormToActivePreset()
    const presetId = id?.trim()
    if (!presetId) {
      return { ok: false, error: translateApiError('invalid_id') }
    }
    const res = await fetch(
      `/api/settings/presets/${encodeURIComponent(presetId)}`,
      { method: 'DELETE' },
    )
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    if (!res.ok) {
      const err =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: unknown }).error ?? '')
          : ''
      return {
        ok: false,
        error: translateApiError(err || 'settings_write_failed'),
        references:
          payload &&
          typeof payload === 'object' &&
          Array.isArray((payload as { references?: unknown }).references)
            ? ((payload as { references: ApiConfigReference[] }).references)
            : undefined,
      }
    }
    await loadFromServer()
    return { ok: true }
  }

  async function testActivePresetConnection(): Promise<
    | {
        ok: true
        totalLatencyMs: number
        models: {
          modelCount: number
          latencyMs: number
          sampleModels: string[]
        }
        chat: {
          model: string
          latencyMs: number
          replyPreview: string
          replyWarning?: 'truncated'
        }
      }
    | {
        ok: false
        error: string
        phase?: 'models' | 'chat'
        detail?: string
        status?: number
        requestUrl?: string
        latencyMs?: number
        model?: string
        models?: {
          modelCount: number
          latencyMs: number
        }
      }
  > {
    syncFormToActivePreset()
    const presetId = activePresetId.value
    if (!presetId) {
      return { ok: false, error: translateApiError('invalid_id'), phase: 'models' }
    }
    const res = await fetch(
      `/api/settings/presets/${encodeURIComponent(presetId)}/test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: baseUrl.value.trim() || undefined,
          model: model.value.trim() || undefined,
        }),
      },
    )
    const data = (await res.json()) as {
      ok?: boolean
      error?: string
      phase?: 'models' | 'chat'
      detail?: string
      status?: number
      requestUrl?: string
      latencyMs?: number
      model?: string
      totalLatencyMs?: number
      models?: {
        modelCount: number
        latencyMs: number
        sampleModels: string[]
      }
      phases?: {
        models: {
          modelCount: number
          latencyMs: number
          sampleModels: string[]
        }
        chat: {
          model: string
          latencyMs: number
          replyPreview: string
          replyWarning?: 'truncated'
        }
      }
    }
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: translateApiError(data.error ?? 'api_preset_test_failed'),
        phase: data.phase,
        detail: data.detail,
        status: data.status,
        requestUrl: data.requestUrl,
        latencyMs: data.latencyMs,
        model: data.model,
        models: data.models
          ? {
              modelCount: data.models.modelCount,
              latencyMs: data.models.latencyMs,
            }
          : undefined,
      }
    }
    const phases = data.phases
    if (!phases) {
      return { ok: false, error: translateApiError('api_preset_test_failed') }
    }
    return {
      ok: true,
      totalLatencyMs: data.totalLatencyMs ?? 0,
      models: {
        modelCount: phases.models.modelCount,
        latencyMs: phases.models.latencyMs,
        sampleModels: phases.models.sampleModels,
      },
      chat: {
        model: phases.chat.model,
        latencyMs: phases.chat.latencyMs,
        replyPreview: phases.chat.replyPreview,
        replyWarning: phases.chat.replyWarning,
      },
    }
  }

  function parseCustomParams(): Record<string, unknown> | undefined {
    const t = customParamsJson.value.trim()
    if (!t) return undefined
    const parsed: unknown = JSON.parse(t)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('自定义参数须为 JSON 对象，例如 {"key": 1}')
    }
    return parsed as Record<string, unknown>
  }

  function uniqueApiPresetAlias(rawAlias: string): string {
    const base = rawAlias.trim() || 'Imported'
    const taken = new Set(presets.value.map((p) => p.alias.trim()))
    if (!taken.has(base)) return base
    for (let i = 2; i < 2000; i++) {
      const c = `${base} (${i})`
      if (!taken.has(c)) return c
    }
    return `${base}-${Date.now()}`
  }

  function mergeSnapshotFromExportDoc(
    raw: Record<string, unknown>,
    opts: { applyBaseUrl: boolean; applyApiKey: boolean },
  ): ApiSettingsSnapshot {
    const d = defaultPresetFields()
    const num = (k: keyof ApiSettingsSnapshot): number | null => {
      const v = raw[k as string]
      if (v === null) return null
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
        return Number(v)
      }
      const def = d[k]
      return typeof def === 'number' || def === null ? (def as number | null) : null
    }
    const bool = (k: keyof ApiSettingsSnapshot, def: boolean): boolean => {
      const v = raw[k as string]
      if (typeof v === 'boolean') return v
      return def
    }
    const str = (k: keyof ApiSettingsSnapshot, def: string): string => {
      const v = raw[k as string]
      return typeof v === 'string' ? v : def
    }
    const legacyDry = migrateLegacyDryField(raw)
    return {
      alias:
        typeof raw.alias === 'string' && raw.alias.trim()
          ? raw.alias.trim()
          : d.alias,
      baseUrl:
        opts.applyBaseUrl &&
        typeof raw.baseUrl === 'string' &&
        raw.baseUrl.trim()
          ? raw.baseUrl.trim()
          : d.baseUrl,
      apiKey:
        opts.applyApiKey && typeof raw.apiKey === 'string' ? raw.apiKey : '',
      model:
        typeof raw.model === 'string' && raw.model.trim()
          ? raw.model.trim()
          : d.model,
      contextLength: num('contextLength'),
      maxTokens: num('maxTokens'),
      stream: bool('stream', d.stream),
      temperature: num('temperature'),
      topP: num('topP'),
      topK: num('topK'),
      dryMultiplier: num('dryMultiplier') ?? legacyDry.dryMultiplier ?? null,
      dryBase: num('dryBase') ?? legacyDry.dryBase ?? null,
      dryAllowedLength:
        num('dryAllowedLength') ?? legacyDry.dryAllowedLength ?? null,
      dryPenaltyLastN:
        num('dryPenaltyLastN') ?? legacyDry.dryPenaltyLastN ?? null,
      drySequenceBreakers: Array.isArray(raw.drySequenceBreakers)
        ? normalizeDrySequenceBreakers(raw.drySequenceBreakers)
        : d.drySequenceBreakers,
      frequencyPenalty: num('frequencyPenalty'),
      presencePenalty: num('presencePenalty'),
      customParamsJson: str('customParamsJson', d.customParamsJson),
      showReasoningChain: bool('showReasoningChain', d.showReasoningChain),
      requestReasoningChain: bool(
        'requestReasoningChain',
        d.requestReasoningChain,
      ),
    }
  }

  async function exportActiveApiPresetDocument(opts: {
    includeBaseUrl: boolean
    includeApiKey: boolean
    includeLinkedPromptPreset: boolean
  }): Promise<{ json: string; filename: string }> {
    syncFormToActivePreset()
    const aid = activePresetId.value
    if (!aid) throw new Error('未选择 API 预设')
    const cur = presets.value.find((p) => p.id === aid)
    if (!cur) throw new Error('当前 API 预设不存在')
    const snap = snapshot()
    const apiPreset: Record<string, unknown> = {
      alias: snap.alias,
      model: snap.model,
      contextLength: snap.contextLength,
      maxTokens: snap.maxTokens,
      stream: snap.stream,
      temperature: snap.temperature,
      topP: snap.topP,
      topK: snap.topK,
      dryMultiplier: snap.dryMultiplier,
      dryBase: snap.dryBase,
      dryAllowedLength: snap.dryAllowedLength,
      dryPenaltyLastN: snap.dryPenaltyLastN,
      drySequenceBreakers: snap.drySequenceBreakers,
      frequencyPenalty: snap.frequencyPenalty,
      presencePenalty: snap.presencePenalty,
      customParamsJson: snap.customParamsJson,
      showReasoningChain: snap.showReasoningChain,
      requestReasoningChain: snap.requestReasoningChain,
    }
    if (opts.includeBaseUrl) apiPreset.baseUrl = snap.baseUrl
    if (opts.includeApiKey) apiPreset.apiKey = snap.apiKey
    if (cur.apiKeyId) apiPreset.apiKeyId = cur.apiKeyId
    const doc: Record<string, unknown> = {
      schema: API_PRESET_EXPORT_SCHEMA,
      exportedAt: new Date().toISOString(),
      apiPreset,
    }
    if (opts.includeLinkedPromptPreset && cur.linkedPromptPresetId) {
      const promptsSt = usePromptsStore()
      if (!promptsSt.loaded) await promptsSt.loadIndexFromServer()
      const linkId = cur.linkedPromptPresetId
      if (linkId) {
        await promptsSt.ensurePresetLoaded(linkId)
        const pp = promptsSt.presetBodies[linkId]
        if (pp) doc.linkedPromptPreset = JSON.parse(JSON.stringify(pp))
      }
    }
    const aliasSafe =
      (snap.alias || 'api-preset').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) ||
      'api-preset'
    return {
      json: JSON.stringify(doc, null, 2),
      filename: `${aliasSafe}.api-preset.json`,
    }
  }

  async function importApiPresetFromParsed(
    doc: ApiPresetExportDoc,
    opts: {
      applyBaseUrl: boolean
      applyApiKey: boolean
      importLinkedPromptPreset: boolean
    },
  ): Promise<void> {
    const merged = mergeSnapshotFromExportDoc(doc.apiPreset, {
      applyBaseUrl: opts.applyBaseUrl,
      applyApiKey: opts.applyApiKey,
    })
    merged.alias = uniqueApiPresetAlias(
      typeof doc.apiPreset.alias === 'string'
        ? doc.apiPreset.alias
        : merged.alias,
    )
    let linkedId: string | null = null
    if (
      opts.importLinkedPromptPreset &&
      doc.linkedPromptPreset &&
      isPromptPresetLike(doc.linkedPromptPreset)
    ) {
      const promptsSt = usePromptsStore()
      if (!promptsSt.loaded) await promptsSt.loadIndexFromServer()
      linkedId = promptsSt.appendPromptPresetCopy(
        doc.linkedPromptPreset as PromptPreset,
      )
    }
    const rawAp = doc.apiPreset
    let importKeyId: string | null = null
    const rawKid =
      typeof rawAp.apiKeyId === 'string' && rawAp.apiKeyId.trim()
        ? rawAp.apiKeyId.trim()
        : null
    if (rawKid) {
      const keychain = useApiKeysStore()
      if (!keychain.loaded) await keychain.loadFromServer()
      if (keychain.findById(rawKid)) importKeyId = rawKid
    }
    syncFormToActivePreset()
    const id = allocateShortId(collectUsedApiPresetIds(presets.value))
    const next: ApiPreset = {
      id,
      ...merged,
      apiKey: importKeyId ? '' : merged.apiKey,
      linkedPromptPresetId: linkedId,
      apiKeyId: importKeyId,
    }
    presets.value.push(next)
    activePresetId.value = id
    applyPresetToForm(next)
    if (!importKeyId && merged.apiKey.trim()) {
      apiKey.value = merged.apiKey
      apiKeyDraftDirty.value = true
    }
    void applyLinkedPromptPresetForApiPreset(id)
  }

  function documentPayload(): Pick<
    ApiSettingsDocument,
    'activePresetId' | 'presets'
  > {
    syncFormToActivePreset()
    const id = activePresetId.value
    if (!id) throw new Error('未选择预设')
    return {
      activePresetId: id,
      presets: presets.value.map((p) => {
        const row: Record<string, unknown> = { ...p }
        if (p.id === id && apiKeyDraftDirty.value) {
          row.apiKey = apiKey.value
        } else {
          delete row.apiKey
        }
        return row as ApiPreset
      }),
    }
  }

  let loadSettingsInflight: Promise<boolean> | null = null

  async function loadFromServer(): Promise<boolean> {
    if (loadSettingsInflight) return loadSettingsInflight
    loadSettingsInflight = (async () => {
      const res = await fetch('/api/settings')
      if (!res.ok) {
        return false
      }
      const raw: unknown = await res.json()
      if (raw === null) {
        presets.value = []
        activePresetId.value = null
        return true
      }
      if (typeof raw !== 'object' || raw === null) return false

      const doc = raw as Partial<ApiSettingsDocument>
      if (doc.version !== 1 || !Array.isArray(doc.presets)) {
        return false
      }

      if (doc.presets.length === 0) {
        presets.value = []
        activePresetId.value = null
        return true
      }

      presets.value = (doc.presets as ApiPreset[]).map(normalizePreset)
      activePresetId.value =
        typeof doc.activePresetId === 'string' ? doc.activePresetId : null
      if (
        !activePresetId.value ||
        !presets.value.some((p) => p.id === activePresetId.value)
      ) {
        activePresetId.value = presets.value[0]?.id ?? null
      }
      applyActivePresetToForm()
      if (typeof doc.savedAt === 'string') lastSavedAt.value = doc.savedAt
      const aid = activePresetId.value
      if (aid) await applyLinkedPromptPresetForApiPreset(aid)
      return true
    })().finally(() => {
      loadSettingsInflight = null
    })
    return loadSettingsInflight
  }

  async function saveToServer(): Promise<void> {
    const body = documentPayload()
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let msg = `保存失败 (${res.status})`
      try {
        const j = (await res.json()) as { error?: string }
        if (j.error) msg = translateApiError(j.error)
      } catch {
        /*  */
      }
      throw new Error(msg)
    }
    const j = (await res.json()) as { savedAt?: string }
    if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
    if (apiKeyDraftDirty.value) {
      const aid = activePresetId.value
      const idx = presets.value.findIndex((p) => p.id === aid)
      if (idx >= 0) {
        presets.value[idx] = {
          ...presets.value[idx],
          keyConfigured: apiKey.value.trim().length > 0,
        }
      }
      apiKey.value = ''
      apiKeyDraftDirty.value = false
    }
  }

  return {
    presets,
    activePresetId,
    alias,
    baseUrl,
    apiKey,
    model,
    contextLength,
    maxTokens,
    stream,
    temperature,
    topP,
    topK,
    dryMultiplier,
    dryBase,
    dryAllowedLength,
    dryPenaltyLastN,
    drySequenceBreakers,
    frequencyPenalty,
    presencePenalty,
    customParamsJson,
    showReasoningChain,
    requestReasoningChain,
    linkedPromptPresetId,
    apiKeyId,
    isApiKeyConfigured,
    markApiKeyDraftDirty,
    apiKeyDraftDirty,
    setApiKeyId,
    lastSavedAt,
    presetSelectItems,
    snapshot,
    switchPreset,
    addPreset,
    removeActivePreset,
    removePresetById,
    testActivePresetConnection,
    loadFromServer,
    saveToServer,
    parseCustomParams,
    exportActiveApiPresetDocument,
    importApiPresetFromParsed,
  }
})
