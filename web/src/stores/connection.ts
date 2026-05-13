import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { usePromptsStore, type PromptPreset } from '@/stores/prompts'
import { useApiKeysStore } from '@/stores/apiKeys'
import {
  API_PRESET_EXPORT_SCHEMA,
  type ApiPresetExportDoc,
  isPromptPresetLike,
} from '@/utils/api-preset-export'

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
  dry: number | null
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
}

export interface ApiSettingsDocument {
  version: 1
  savedAt: string
  activePresetId: string
  presets: ApiPreset[]
}

function newId(): string {
  return crypto.randomUUID()
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
    dry: null,
    frequencyPenalty: null,
    presencePenalty: null,
    customParamsJson: '',
    showReasoningChain: true,
    requestReasoningChain: false,
  }
}

function normalizePreset(p: ApiPreset): ApiPreset {
  const link =
    typeof p.linkedPromptPresetId === 'string' && p.linkedPromptPresetId.trim()
      ? p.linkedPromptPresetId.trim()
      : null
  const keyId =
    typeof p.apiKeyId === 'string' && p.apiKeyId.trim()
      ? p.apiKeyId.trim()
      : null
  return {
    ...p,
    linkedPromptPresetId: link,
    apiKeyId: keyId,
    showReasoningChain:
      typeof p.showReasoningChain === 'boolean' ? p.showReasoningChain : true,
    requestReasoningChain:
      typeof p.requestReasoningChain === 'boolean'
        ? p.requestReasoningChain
        : false,
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
  const dry = ref<number | null>(null)
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

  const lastSavedAt = ref<string | null>(null)

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
      dry: dry.value,
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
    if (o.dry === null || typeof o.dry === 'number') dry.value = o.dry ?? null
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
    applySnapshot(p)
    linkedPromptPresetId.value = p.linkedPromptPresetId ?? null
    const kid = p.apiKeyId ?? null
    apiKeyId.value = kid
    if (kid) {
      const keychain = useApiKeysStore()
      const entry = keychain.findById(kid)
      if (entry) {
        apiKey.value = entry.key
      } else if (keychain.loaded) {
        // keychain 已加载但找不到 id：把引用清空，回退到原 apiKey 字段
        apiKeyId.value = null
      } else {
        // keychain 还没加载：先用现成的 apiKey 字段顶着，加载完再 hydrate
        void keychain.loadFromServer().then(() => {
          if (apiKeyId.value === kid) {
            const e2 = keychain.findById(kid)
            if (e2) apiKey.value = e2.key
            else apiKeyId.value = null
          }
        })
      }
    }
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
    if (kid) {
      const keychain = useApiKeysStore()
      if (keychain.findById(kid)) {
        keychain.updateKey(kid, { key: apiKey.value })
      }
    }
    const snap = snapshot()
    presets.value[i] = {
      id,
      ...snap,
      apiKey: kid ? '' : snap.apiKey,
      linkedPromptPresetId:
        linkedPromptPresetId.value == null ||
        linkedPromptPresetId.value === ''
          ? null
          : String(linkedPromptPresetId.value),
      apiKeyId: kid,
    }
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
      await prompts.loadFromServer()
    }
    if (prompts.presets.some((p) => p.id === link)) {
      prompts.selectPreset(link)
    }
  }

  function switchPreset(newId: string) {
    if (newId === activePresetId.value) return
    syncFormToActivePreset()
    activePresetId.value = newId
    applyActivePresetToForm()
    void applyLinkedPromptPresetForApiPreset(newId)
  }

  function ensureDefaultPresets() {
    if (presets.value.length > 0 && activePresetId.value) return
    const id = newId()
    const p: ApiPreset = {
      id,
      ...defaultPresetFields(),
      linkedPromptPresetId: null,
      apiKeyId: null,
    }
    presets.value = [p]
    activePresetId.value = id
    applyPresetToForm(p)
  }

  /** 切换当前预设引用的 API Key 别名 id；null 代表使用预设内联的 apiKey 字段 */
  function setApiKeyId(id: string | null) {
    if (!id) {
      apiKeyId.value = null
      const aid = activePresetId.value
      const p = aid ? presets.value.find((x) => x.id === aid) : null
      apiKey.value = p?.apiKey ?? ''
      syncFormToActivePreset()
      return
    }
    const keychain = useApiKeysStore()
    const apply = (entry: ReturnType<typeof keychain.findById>) => {
      if (entry) {
        apiKeyId.value = id
        apiKey.value = entry.key
      } else {
        apiKeyId.value = null
        const aid = activePresetId.value
        const p = aid ? presets.value.find((x) => x.id === aid) : null
        apiKey.value = p?.apiKey ?? ''
      }
      syncFormToActivePreset()
    }
    const e0 = keychain.findById(id)
    if (e0) {
      apply(e0)
      return
    }
    void keychain.loadFromServer().then(() => {
      apply(keychain.findById(id))
    })
  }

  /** 监听 keychain 中当前引用条目的 key 变化，让表单 apiKey ref 自动同步 */
  function bindKeychainSync() {
    const keychain = useApiKeysStore()
    watch(
      () => (apiKeyId.value ? keychain.findById(apiKeyId.value)?.key : null),
      (k) => {
        if (apiKeyId.value && typeof k === 'string') {
          apiKey.value = k
        }
      },
    )
  }
  bindKeychainSync()

  function addPreset() {
    syncFormToActivePreset()
    const id = newId()
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

  function removeActivePreset() {
    if (presets.value.length <= 1) return
    syncFormToActivePreset()
    const id = activePresetId.value
    if (!id) return
    const idx = presets.value.findIndex((p) => p.id === id)
    if (idx < 0) return
    presets.value.splice(idx, 1)
    activePresetId.value = presets.value[0]?.id ?? null
    applyActivePresetToForm()
    const nextId = activePresetId.value
    if (nextId) void applyLinkedPromptPresetForApiPreset(nextId)
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
      dry: num('dry'),
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
      dry: snap.dry,
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
      if (!promptsSt.loaded) await promptsSt.loadFromServer()
      const pp = promptsSt.presets.find(
        (p) => p.id === cur.linkedPromptPresetId,
      )
      if (pp) doc.linkedPromptPreset = JSON.parse(JSON.stringify(pp))
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
      if (!promptsSt.loaded) await promptsSt.loadFromServer()
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
    const id = newId()
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
      presets: presets.value.map((p) => ({ ...p })),
    }
  }

  async function loadFromServer(): Promise<boolean> {
    const res = await fetch('/api/settings')
    if (!res.ok) {
      ensureDefaultPresets()
      return false
    }
    const raw: unknown = await res.json()
    if (raw === null) {
      ensureDefaultPresets()
      return false
    }
    if (typeof raw !== 'object' || raw === null) return false

    const doc = raw as Partial<ApiSettingsDocument>
    if (doc.version !== 1 || !Array.isArray(doc.presets)) {
      ensureDefaultPresets()
      return false
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
    if (aid) void applyLinkedPromptPresetForApiPreset(aid)
    return true
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
        if (j.error) msg = j.error
      } catch {
        /*  */
      }
      throw new Error(msg)
    }
    const j = (await res.json()) as { savedAt?: string }
    if (typeof j.savedAt === 'string') lastSavedAt.value = j.savedAt
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
    dry,
    frequencyPenalty,
    presencePenalty,
    customParamsJson,
    showReasoningChain,
    requestReasoningChain,
    linkedPromptPresetId,
    apiKeyId,
    setApiKeyId,
    lastSavedAt,
    presetSelectItems,
    snapshot,
    switchPreset,
    addPreset,
    removeActivePreset,
    ensureDefaultPresets,
    loadFromServer,
    saveToServer,
    parseCustomParams,
    exportActiveApiPresetDocument,
    importApiPresetFromParsed,
  }
})
