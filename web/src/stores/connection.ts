import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
  return {
    ...p,
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
  }

  /** 将当前表单写回当前激活的预设条目 */
  function syncFormToActivePreset() {
    const id = activePresetId.value
    if (!id) return
    const i = presets.value.findIndex((p) => p.id === id)
    if (i < 0) return
    presets.value[i] = { id, ...snapshot() }
  }

  function applyActivePresetToForm() {
    const id = activePresetId.value
    if (!id) return
    const p = presets.value.find((x) => x.id === id)
    if (p) applyPresetToForm(p)
  }

  function switchPreset(newId: string) {
    if (newId === activePresetId.value) return
    syncFormToActivePreset()
    activePresetId.value = newId
    applyActivePresetToForm()
  }

  function ensureDefaultPresets() {
    if (presets.value.length > 0 && activePresetId.value) return
    const id = newId()
    const p: ApiPreset = { id, ...defaultPresetFields() }
    presets.value = [p]
    activePresetId.value = id
    applyPresetToForm(p)
  }

  function addPreset() {
    syncFormToActivePreset()
    const id = newId()
    const p: ApiPreset = {
      id,
      ...defaultPresetFields(),
      alias: `预设 ${presets.value.length + 1}`,
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
  }
})
