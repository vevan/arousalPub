<script setup lang="ts">
import { bootstrapAppData } from '@/bootstrap/app-data'
import { usePromptsStore } from '@/stores/prompts'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  conversationId: string
  /** `null` / 未绑定：使用全局激活预设 */
  initialPromptPresetId?: string | null
  initialCharacterIds: string[]
  initialLorebookIds: string[]
  /** 未覆盖时继承全局 */
  initialLorebookSettingsUseGlobal?: boolean
  globalLoreRecursiveEnabled?: boolean
  globalLoreMaxRecursionDepth?: number
  initialLorebookRecursiveEnabled?: boolean
  initialLorebookMaxRecursionDepth?: number
  initialHistorySettingsUseGlobal?: boolean
  globalHistoryLimitEnabled?: boolean
  globalHistoryMaxTurns?: number
  initialHistoryLimitEnabled?: boolean
  initialHistoryMaxTurns?: number
  /** 会话内 `{{user}}` 展示名；空表示用默认「用户」 */
  initialUserName?: string | null
}>()

const emit = defineEmits<{
  (e: 'patched', index: Record<string, unknown>): void
}>()

const { t } = useI18n()
const promptsStore = usePromptsStore()
const { presets, loaded: promptsLoaded } = storeToRefs(promptsStore)

const INHERIT_VALUE = ''

const presetModel = ref<string>(INHERIT_VALUE)
const characterModel = ref<string[]>([])

const savingPreset = ref(false)
const savingChars = ref(false)
const savingLorebooks = ref(false)
const savingLoreSettings = ref(false)
const savingHistorySettings = ref(false)
const errorText = ref('')

const lorebookModel = ref<string[]>([])
const loreUseGlobal = ref(true)
const loreRecursiveEnabled = ref(false)
const loreMaxRecursionDepth = ref(2)

const loreDepthItems = [0, 1, 2, 3] as const

/** 提示词宏名；勿写入 i18n（vue-i18n 会将 `{{` 当作占位符） */
const PROMPT_USER_MACRO = '{{user}}'

const historyUseGlobal = ref(true)
const historyLimitEnabled = ref(false)
const historyMaxTurns = ref(20)

interface CharItem {
  id: string
  name: string
}

interface LorebookItem {
  id: string
  name: string
}

const charItems = ref<CharItem[]>([])
const charItemsLoading = ref(false)
const lorebookItems = ref<LorebookItem[]>([])
const lorebookItemsLoading = ref(false)

const presetItems = computed(() => {
  const inherit = {
    title: t('chat.convSettings.useGlobalPreset'),
    value: INHERIT_VALUE,
  }
  const rest = presets.value.map((p) => ({
    title: p.name,
    value: p.id,
  }))
  return [inherit, ...rest]
})

function currentPresetTarget(): string | null {
  const v = presetModel.value.trim()
  if (!v || v === INHERIT_VALUE) return null
  return v
}

function propsPresetTarget(): string | null {
  const s = props.initialPromptPresetId
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

function propsLoreUseGlobal(): boolean {
  return props.initialLorebookSettingsUseGlobal !== false
}

function propsGlobalLoreRecursiveEnabled(): boolean {
  return props.globalLoreRecursiveEnabled === true
}

function propsGlobalLoreMaxRecursionDepth(): number {
  const d = props.globalLoreMaxRecursionDepth
  if (typeof d !== 'number' || !Number.isFinite(d)) return 2
  return Math.max(0, Math.min(3, Math.floor(d)))
}

function propsLoreRecursiveEnabled(): boolean {
  return props.initialLorebookRecursiveEnabled === true
}

function propsLoreMaxRecursionDepth(): number {
  const d = props.initialLorebookMaxRecursionDepth
  if (typeof d !== 'number' || !Number.isFinite(d)) return 2
  return Math.max(0, Math.min(3, Math.floor(d)))
}

function propsHistoryUseGlobal(): boolean {
  return props.initialHistorySettingsUseGlobal !== false
}

function propsGlobalHistoryLimitEnabled(): boolean {
  return props.globalHistoryLimitEnabled === true
}

function propsGlobalHistoryMaxTurns(): number {
  const d = props.globalHistoryMaxTurns
  if (typeof d !== 'number' || !Number.isFinite(d)) return 20
  return Math.max(1, Math.min(200, Math.floor(d)))
}

function propsHistoryLimitEnabled(): boolean {
  return props.initialHistoryLimitEnabled === true
}

function propsHistoryMaxTurns(): number {
  const d = props.initialHistoryMaxTurns
  if (typeof d !== 'number' || !Number.isFinite(d)) return 20
  return Math.max(1, Math.min(200, Math.floor(d)))
}

function syncFromProps() {
  errorText.value = ''
  presetModel.value = propsPresetTarget() ?? INHERIT_VALUE
  characterModel.value = [...props.initialCharacterIds]
  lorebookModel.value = [...props.initialLorebookIds]
  loreUseGlobal.value = propsLoreUseGlobal()
  if (loreUseGlobal.value) {
    loreRecursiveEnabled.value = propsGlobalLoreRecursiveEnabled()
    loreMaxRecursionDepth.value = propsGlobalLoreMaxRecursionDepth()
  } else {
    loreRecursiveEnabled.value = propsLoreRecursiveEnabled()
    loreMaxRecursionDepth.value = propsLoreMaxRecursionDepth()
  }
  historyUseGlobal.value = propsHistoryUseGlobal()
  if (historyUseGlobal.value) {
    historyLimitEnabled.value = propsGlobalHistoryLimitEnabled()
    historyMaxTurns.value = propsGlobalHistoryMaxTurns()
  } else {
    historyLimitEnabled.value = propsHistoryLimitEnabled()
    historyMaxTurns.value = propsHistoryMaxTurns()
  }
}

watch(
  () => [
    props.conversationId,
    props.initialPromptPresetId,
    props.initialCharacterIds,
    props.initialLorebookIds,
    props.initialLorebookSettingsUseGlobal,
    props.globalLoreRecursiveEnabled,
    props.globalLoreMaxRecursionDepth,
    props.initialLorebookRecursiveEnabled,
    props.initialLorebookMaxRecursionDepth,
    props.initialHistorySettingsUseGlobal,
    props.globalHistoryLimitEnabled,
    props.globalHistoryMaxTurns,
    props.initialHistoryLimitEnabled,
    props.initialHistoryMaxTurns,
    props.initialUserName,
  ],
  () => syncFromProps(),
  { deep: true },
)

watch(presetModel, async () => {
  const target = currentPresetTarget()
  const cur = propsPresetTarget()
  if (target === cur) return
  savingPreset.value = true
  errorText.value = ''
  try {
    await patchConversation({
      promptPresetId: target,
    })
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingPreset.value = false
  }
})

watch(
  characterModel,
  async (ids) => {
    const a = [...ids].sort().join('\u0000')
    const b = [...props.initialCharacterIds].sort().join('\u0000')
    if (a === b) return
    savingChars.value = true
    errorText.value = ''
    try {
      await patchConversation({ characterIds: [...ids] })
    } catch (e) {
      errorText.value =
        e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
      syncFromProps()
    } finally {
      savingChars.value = false
    }
  },
  { deep: true },
)

watch(
  lorebookModel,
  async (ids) => {
    const a = [...ids].sort().join('\u0000')
    const b = [...props.initialLorebookIds].sort().join('\u0000')
    if (a === b) return
    savingLorebooks.value = true
    errorText.value = ''
    try {
      await patchConversation({ lorebookIds: [...ids] })
    } catch (e) {
      errorText.value =
        e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
      syncFromProps()
    } finally {
      savingLorebooks.value = false
    }
  },
  { deep: true },
)

watch(loreUseGlobal, async (useGlobal) => {
  if (useGlobal === propsLoreUseGlobal()) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ lorebookSettings: null })
    } else {
      await patchConversation({
        lorebookSettings: {
          recursiveEnabled: loreRecursiveEnabled.value,
          maxRecursionDepth: loreMaxRecursionDepth.value,
        },
      })
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

async function saveLoreOverride() {
  await patchConversation({
    lorebookSettings: {
      recursiveEnabled: loreRecursiveEnabled.value,
      maxRecursionDepth: loreMaxRecursionDepth.value,
    },
  })
}

watch(loreRecursiveEnabled, async (enabled) => {
  const target = loreUseGlobal.value
    ? propsGlobalLoreRecursiveEnabled()
    : propsLoreRecursiveEnabled()
  if (enabled === target) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    await saveLoreOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

watch(loreMaxRecursionDepth, async (depth) => {
  const target = loreUseGlobal.value
    ? propsGlobalLoreMaxRecursionDepth()
    : propsLoreMaxRecursionDepth()
  if (depth === target) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    await saveLoreOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

watch(historyUseGlobal, async (useGlobal) => {
  if (useGlobal === propsHistoryUseGlobal()) return
  savingHistorySettings.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ historySettings: null })
    } else {
      await patchConversation({
        historySettings: {
          limitEnabled: historyLimitEnabled.value,
          maxTurns: historyMaxTurns.value,
        },
      })
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingHistorySettings.value = false
  }
})

async function saveHistoryOverride() {
  await patchConversation({
    historySettings: {
      limitEnabled: historyLimitEnabled.value,
      maxTurns: historyMaxTurns.value,
    },
  })
}

watch(historyLimitEnabled, async (enabled) => {
  const target = historyUseGlobal.value
    ? propsGlobalHistoryLimitEnabled()
    : propsHistoryLimitEnabled()
  if (enabled === target) return
  savingHistorySettings.value = true
  errorText.value = ''
  try {
    await saveHistoryOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingHistorySettings.value = false
  }
})

watch(historyMaxTurns, async (turns) => {
  const target = historyUseGlobal.value
    ? propsGlobalHistoryMaxTurns()
    : propsHistoryMaxTurns()
  if (turns === target) return
  savingHistorySettings.value = true
  errorText.value = ''
  try {
    await saveHistoryOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingHistorySettings.value = false
  }
})

onMounted(() => {
  syncFromProps()
  void bootstrapAppData()
  void loadCharacters()
  void loadLorebooks()
})

async function loadLorebooks() {
  lorebookItemsLoading.value = true
  try {
    const res = await fetch('/api/lorebooks')
    if (!res.ok) return
    const raw: unknown = await res.json()
    if (!raw || typeof raw !== 'object') return
    const list = (raw as { lorebooks?: { id?: string; name?: string }[] })
      .lorebooks
    lorebookItems.value = (list ?? [])
      .filter((x) => typeof x.id === 'string' && x.id.trim())
      .map((x) => ({
        id: x.id as string,
        name: typeof x.name === 'string' ? x.name : (x.id as string),
      }))
  } catch {
    /* ignore */
  } finally {
    lorebookItemsLoading.value = false
  }
}

async function loadCharacters() {
  charItemsLoading.value = true
  try {
    const res = await fetch('/api/characters?limit=100&offset=0')
    if (!res.ok) return
    const j = (await res.json()) as {
      items?: { id?: string; name?: string }[]
    }
    const raw = j.items ?? []
    charItems.value = raw
      .filter((x) => typeof x.id === 'string' && x.id.trim())
      .map((x) => ({
        id: x.id as string,
        name: typeof x.name === 'string' ? x.name : (x.id as string),
      }))
  } catch {
    /* ignore */
  } finally {
    charItemsLoading.value = false
  }
}

async function patchConversation(body: Record<string, unknown>) {
  const res = await fetch(`/api/chat/conversations/${props.conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(txt.slice(0, 200))
  }
  const j = (await res.json()) as { index?: Record<string, unknown> }
  if (j.index) emit('patched', j.index)
}
</script>

<template>
  <v-expansion-panels
    class="conv-context-settings"
    variant="accordion"
    density="compact"
  >
    <v-expansion-panel rounded="lg">
      <v-expansion-panel-title class="text-body-2 font-weight-medium py-2">
        {{ $t('chat.convSettings.title') }}
      </v-expansion-panel-title>
      <v-expansion-panel-text class="conv-context-settings__body">
        <v-alert
          v-if="errorText"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-3"
          closable
          @click:close="errorText = ''"
        >
          {{ errorText }}
        </v-alert>

        <div class="conv-context-settings__field">
          <v-select
            v-model="presetModel"
            :items="presetItems"
            item-title="title"
            item-value="value"
            :label="$t('chat.convSettings.promptPreset')"
            density="compact"
            variant="outlined"
            hide-details="auto"
            :loading="savingPreset || !promptsLoaded"
            :disabled="!promptsLoaded"
          />
        </div>

        <div
          v-if="initialUserName"
          class="conv-context-settings__field"
        >
          <v-alert
            density="compact"
            variant="tonal"
            type="info"
          >
            {{ $t('chat.convSettings.userNameSnapshotPrefix') }}<strong>{{ initialUserName }}</strong>{{ $t('chat.convSettings.userNameSnapshotSuffix') }}<code class="user-macro-tag">{{ PROMPT_USER_MACRO }}</code>{{ $t('chat.convSettings.userNameSnapshotSuffixEnd') }}
          </v-alert>
        </div>

        <div class="conv-context-settings__field">
          <v-select
            v-model="characterModel"
            :items="charItems"
            item-title="name"
            item-value="id"
            :label="$t('chat.convSettings.characters')"
            density="compact"
            variant="outlined"
            multiple
            chips
            closable-chips
            hide-details="auto"
            :loading="charItemsLoading || savingChars"
          />
          <p class="text-caption text-medium-emphasis mt-1 mb-0">
            {{ $t('chat.convSettings.charactersHint') }}
          </p>
        </div>

        <div class="conv-context-settings__field">
          <v-select
            v-model="lorebookModel"
            :items="lorebookItems"
            item-title="name"
            item-value="id"
            :label="$t('chat.convSettings.lorebooks')"
            density="compact"
            variant="outlined"
            multiple
            chips
            closable-chips
            hide-details="auto"
            :loading="lorebookItemsLoading || savingLorebooks"
          />
          <p class="text-caption text-medium-emphasis mt-1 mb-0">
            {{ $t('chat.convSettings.lorebooksHint') }}
          </p>
        </div>

        <div class="conv-context-settings__field">
          <v-switch
            v-model="loreUseGlobal"
            :label="$t('chat.convSettings.loreUseGlobal')"
            density="compact"
            hide-details
            color="primary"
            :loading="savingLoreSettings"
            :disabled="savingLoreSettings"
          />
          <p
            v-if="loreUseGlobal"
            class="text-caption text-medium-emphasis mt-1 mb-2"
          >
            {{ $t('chat.convSettings.loreInheritGlobalHint') }}
          </p>
          <v-switch
            v-model="loreRecursiveEnabled"
            :label="$t('chat.convSettings.loreRecursiveEnabled')"
            density="compact"
            hide-details
            color="primary"
            class="mt-1"
            :loading="savingLoreSettings"
            :disabled="loreUseGlobal || savingLoreSettings"
          />
          <p class="text-caption text-medium-emphasis mt-1 mb-2">
            {{ $t('chat.convSettings.loreRecursiveHint') }}
          </p>
          <v-select
            v-model="loreMaxRecursionDepth"
            :items="[...loreDepthItems]"
            :label="$t('chat.convSettings.loreMaxRecursionDepth')"
            density="compact"
            variant="outlined"
            hide-details="auto"
            :disabled="loreUseGlobal || !loreRecursiveEnabled || savingLoreSettings"
            :loading="savingLoreSettings"
          />
          <p
            v-if="loreRecursiveEnabled"
            class="text-caption text-medium-emphasis mt-1 mb-0"
          >
            {{ $t('chat.convSettings.loreMaxRecursionDepthHint') }}
          </p>
        </div>

        <div class="conv-context-settings__field">
          <v-switch
            v-model="historyUseGlobal"
            :label="$t('chat.convSettings.historyUseGlobal')"
            density="compact"
            hide-details
            color="primary"
            :loading="savingHistorySettings"
            :disabled="savingHistorySettings"
          />
          <p
            v-if="historyUseGlobal"
            class="text-caption text-medium-emphasis mt-1 mb-2"
          >
            {{ $t('chat.convSettings.historyInheritGlobalHint') }}
          </p>
          <v-switch
            v-model="historyLimitEnabled"
            :label="$t('chat.convSettings.historyLimitEnabled')"
            density="compact"
            hide-details
            color="primary"
            class="mt-1"
            :loading="savingHistorySettings"
            :disabled="historyUseGlobal || savingHistorySettings"
          />
          <p class="text-caption text-medium-emphasis mt-1 mb-2">
            {{ $t('chat.convSettings.historyLimitHint') }}
          </p>
          <v-text-field
            v-model.number="historyMaxTurns"
            type="number"
            min="1"
            max="200"
            step="1"
            :label="$t('chat.convSettings.historyMaxTurns')"
            density="compact"
            variant="outlined"
            hide-details="auto"
            :disabled="historyUseGlobal || !historyLimitEnabled || savingHistorySettings"
            :loading="savingHistorySettings"
          />
          <p
            v-if="historyLimitEnabled"
            class="text-caption text-medium-emphasis mt-1 mb-0"
          >
            {{ $t('chat.convSettings.historyMaxTurnsHint') }}
          </p>
        </div>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<style scoped>
.conv-context-settings {
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: var(--radius, 0.5rem);
  background: rgb(var(--v-theme-surface-light));
}
.conv-context-settings__body {
  padding-top: 0.5rem !important;
}
.conv-context-settings__field + .conv-context-settings__field {
  margin-top: 0.75rem;
}
.user-macro-tag {
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
  padding: 0 0.15em;
}
</style>
