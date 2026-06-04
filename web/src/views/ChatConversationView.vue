<script setup lang="ts">
import ConversationContextSettings from '@/components/ConversationContextSettings.vue'
import HomeChat from '@/components/HomeChat.vue'
import { useMemoryRebuild } from '@/composables/useMemoryRebuild'
import { bootstrapAppData } from '@/bootstrap/app-data'
import { fetchDefaultLorebookIds, fetchLorebookPickerItems } from '@/utils/default-lorebook'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import {
  hasHistorySettingsOverride,
  normalizeHistorySettings,
  resolveHistorySettings,
  type HistorySettings,
} from '@/utils/history-settings'
import {
  hasMemorySettingsOverride,
  normalizeMemorySettings,
  resolveMemorySettings,
  type MemorySettings,
} from '@/utils/memory-settings'
import {
  hasLorebookSettingsOverride,
  normalizeLorebookSettings,
  resolveLorebookSettings,
  type LorebookSettings,
} from '@/utils/lorebook-settings'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const props = defineProps<{
  conversationId: string
}>()

const { t } = useI18n()
const router = useRouter()
const conn = useConnectionStore()
const prefStore = usePreferencesStore()
const {
  lorebookRecursiveEnabled,
  lorebookMaxRecursionDepth,
  lorebookVectorEnabled,
  lorebookVectorTopK,
  historyLimitEnabled,
  historyMaxTurns,
  memoryEnabled,
  memoryTopK,
  embeddingModel,
  embeddingDimensions,
} = storeToRefs(prefStore)

const loading = ref(true)
const errorText = ref('')
const title = ref('')
const titleSaving = ref(false)
const lorebookNameById = ref<Record<string, string>>({})
const convContextSettingsRef = ref<InstanceType<
  typeof ConversationContextSettings
> | null>(null)
const hasConversationTurns = ref(false)
const conversationMemoryEmbeddingModel = ref<string | null>(null)
const conversationMemoryEmbeddingDimensions = ref<number | null>(null)
const memoryRebuildDialogOpen = ref(false)
let memoryRebuildDismissKey = ''

const {
  loading: memoryRebuildLoading,
  error: memoryRebuildError,
  done: memoryRebuildDone,
  total: memoryRebuildTotal,
  turns: memoryRebuildTurns,
  loreEntries: memoryRebuildLoreEntries,
  percent: memoryRebuildPercent,
  rebuild: rebuildMemoryIndex,
} = useMemoryRebuild(() => props.conversationId)

function memoryRebuildDismissToken(
  storedModel: string | null,
  globalModel: string,
  storedDims: number | null,
  globalDims: number | null,
): string {
  return `${storedModel ?? ''}|${globalModel}|${storedDims ?? ''}|${globalDims ?? ''}`
}

function embeddingDimsMatch(a: number | null, b: number | null): boolean {
  return (a ?? null) === (b ?? null)
}

function shouldOfferMemoryRebuild(): boolean {
  if (!hasConversationTurns.value) return false
  if (!convBindings.value.memory.effective.memoryEnabled) return false
  const globalModel = embeddingModel.value.trim()
  if (!globalModel) return false
  const globalDims = embeddingDimensions.value
  const storedModel = conversationMemoryEmbeddingModel.value
  const storedDims = conversationMemoryEmbeddingDimensions.value
  if (!storedModel) return false
  if (
    storedModel === globalModel &&
    embeddingDimsMatch(storedDims, globalDims)
  ) {
    return false
  }
  const token = memoryRebuildDismissToken(
    storedModel,
    globalModel,
    storedDims,
    globalDims,
  )
  if (memoryRebuildDismissKey === token) return false
  return true
}

function maybePromptMemoryRebuild(): void {
  if (shouldOfferMemoryRebuild()) {
    memoryRebuildError.value = ''
    memoryRebuildDialogOpen.value = true
  }
}

function dismissMemoryRebuild(): void {
  memoryRebuildDismissKey = memoryRebuildDismissToken(
    conversationMemoryEmbeddingModel.value,
    embeddingModel.value.trim(),
    conversationMemoryEmbeddingDimensions.value,
    embeddingDimensions.value,
  )
  memoryRebuildDialogOpen.value = false
  memoryRebuildError.value = ''
}

async function confirmMemoryRebuild(): Promise<void> {
  const nextModel = await rebuildMemoryIndex()
  if (!nextModel) return
  conversationMemoryEmbeddingModel.value = nextModel
  memoryRebuildDismissKey = memoryRebuildDismissToken(
    nextModel,
    embeddingModel.value.trim(),
    embeddingDimensions.value,
    embeddingDimensions.value,
  )
  memoryRebuildDialogOpen.value = false
}

function onMemoryRebuiltFromSettings(model: string): void {
  conversationMemoryEmbeddingModel.value = model
  conversationMemoryEmbeddingDimensions.value = embeddingDimensions.value
  memoryRebuildDismissKey = memoryRebuildDismissToken(
    model,
    embeddingModel.value.trim(),
    embeddingDimensions.value,
    embeddingDimensions.value,
  )
}

interface LorebookContextBinding {
  useGlobal: boolean
  effective: LorebookSettings
}

interface HistoryContextBinding {
  useGlobal: boolean
  effective: HistorySettings
}

interface MemoryContextBinding {
  useGlobal: boolean
  effective: MemorySettings
}

interface ConvContextBindings {
  promptPresetId: string | null
  characterIds: string[]
  lorebookIds: string[]
  lorebook: LorebookContextBinding
  history: HistoryContextBinding
  memory: MemoryContextBinding
  /** 会话 `{{user}}`；null 表示未设置 */
  userName: string | null
  /** 用户 persona 卡 id；仅用于 UI 回显头像 */
  userCharacterId: string | null
}

function globalLoreFromStore(): LorebookSettings {
  return normalizeLorebookSettings({
    recursiveEnabled: prefStore.lorebookRecursiveEnabled,
    maxRecursionDepth: prefStore.lorebookMaxRecursionDepth,
    vectorEnabled: prefStore.lorebookVectorEnabled,
    vectorTopK: prefStore.lorebookVectorTopK,
  })
}

function globalHistoryFromStore(): HistorySettings {
  return normalizeHistorySettings({
    limitEnabled: prefStore.historyLimitEnabled,
    maxTurns: prefStore.historyMaxTurns,
  })
}

function globalMemoryFromStore(): MemorySettings {
  return normalizeMemorySettings({
    memoryEnabled: prefStore.memoryEnabled,
    memoryTopK: prefStore.memoryTopK,
  })
}

function memoryContextFromIndex(
  idx: Record<string, unknown>,
): MemoryContextBinding {
  const global = globalMemoryFromStore()
  const raw = idx.memorySettings
  const override =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<MemorySettings>)
      : undefined
  const useGlobal = !hasMemorySettingsOverride(override)
  return {
    useGlobal,
    effective: resolveMemorySettings(global, override),
  }
}

function historyContextFromIndex(
  idx: Record<string, unknown>,
): HistoryContextBinding {
  const global = globalHistoryFromStore()
  const raw = idx.historySettings
  const override =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<HistorySettings>)
      : undefined
  const useGlobal = !hasHistorySettingsOverride(override)
  return {
    useGlobal,
    effective: resolveHistorySettings(global, override),
  }
}

function lorebookContextFromIndex(
  idx: Record<string, unknown>,
): LorebookContextBinding {
  const global = globalLoreFromStore()
  const raw = idx.lorebookSettings
  const override =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<LorebookSettings>)
      : undefined
  const useGlobal = !hasLorebookSettingsOverride(override)
  return {
    useGlobal,
    effective: resolveLorebookSettings(global, override),
  }
}

function clientResolvedCharacterIds(idx: Record<string, unknown>): string[] {
  if (Array.isArray(idx.characterIds)) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of idx.characterIds) {
      if (typeof raw !== 'string') continue
      const id = raw.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }
  if (typeof idx.characterId === 'string' && idx.characterId.trim()) {
    return [idx.characterId.trim()]
  }
  return []
}

function bindingsFromIndex(idx: Record<string, unknown>): ConvContextBindings {
  const pid = idx.promptPresetId
  const promptPresetId =
    typeof pid === 'string' && pid.trim() ? pid.trim() : null
  const lb = idx.lorebookIds
  const lorebookIds = Array.isArray(lb)
    ? lb.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  const un = idx.userName
  const userName =
    typeof un === 'string' && un.trim() ? un.trim() : null
  const uci = idx.userCharacterId
  const userCharacterId =
    typeof uci === 'string' && uci.trim() ? uci.trim() : null
  return {
    promptPresetId,
    characterIds: clientResolvedCharacterIds(idx),
    lorebookIds,
    lorebook: lorebookContextFromIndex(idx),
    history: historyContextFromIndex(idx),
    memory: memoryContextFromIndex(idx),
    userName,
    userCharacterId,
  }
}

const convBindings = ref<ConvContextBindings>({
  promptPresetId: null,
  characterIds: [],
  lorebookIds: [],
  lorebook: {
    useGlobal: true,
    effective: {
      recursiveEnabled: false,
      maxRecursionDepth: 2,
      vectorEnabled: false,
      vectorTopK: 5,
    },
  },
  history: {
    useGlobal: true,
    effective: { limitEnabled: false, maxTurns: 20 },
  },
  memory: {
    useGlobal: true,
    effective: { memoryEnabled: false, memoryTopK: 4 },
  },
  userName: null,
  userCharacterId: null,
})

const boundLorebookLabels = computed(() =>
  convBindings.value.lorebookIds.map(
    (id) => lorebookNameById.value[id] ?? id,
  ),
)

async function loadLorebookNameMap(): Promise<void> {
  const items = await fetchLorebookPickerItems()
  const map: Record<string, string> = {}
  for (const item of items) {
    map[item.id] = item.name
  }
  lorebookNameById.value = map
}

function applyConversationMemoryIndexMeta(index: Record<string, unknown>): void {
  const memModel = index.memoryEmbeddingModel
  conversationMemoryEmbeddingModel.value =
    typeof memModel === 'string' && memModel.trim() ? memModel.trim() : null
  const memDims = index.memoryEmbeddingDimensions
  conversationMemoryEmbeddingDimensions.value =
    typeof memDims === 'number' && Number.isFinite(memDims) && memDims > 0
      ? Math.floor(memDims)
      : null
}

function onConvContextPatched(index: Record<string, unknown>) {
  applyConversationMemoryIndexMeta(index)
  convBindings.value = bindingsFromIndex(index)
  maybePromptMemoryRebuild()
}

async function patchPromptDebugMaxToServer(id: string) {
  await fetch(`/api/chat/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      promptDebug: {
        maxStored: prefStore.writeChatPromptSnapshot
          ? prefStore.promptDebugMaxStored
          : 0,
      },
    }),
  })
}

watch(
  [lorebookRecursiveEnabled, lorebookMaxRecursionDepth, lorebookVectorEnabled, lorebookVectorTopK],
  () => {
  if (!convBindings.value.lorebook.useGlobal) return
  const global = globalLoreFromStore()
  convBindings.value = {
    ...convBindings.value,
    lorebook: {
      useGlobal: true,
      effective: global,
    },
  }
})

watch([historyLimitEnabled, historyMaxTurns], () => {
  if (!convBindings.value.history.useGlobal) return
  const global = globalHistoryFromStore()
  convBindings.value = {
    ...convBindings.value,
    history: {
      useGlobal: true,
      effective: global,
    },
  }
})

watch([memoryEnabled, memoryTopK], () => {
  if (!convBindings.value.memory.useGlobal) return
  const global = globalMemoryFromStore()
  convBindings.value = {
    ...convBindings.value,
    memory: {
      useGlobal: true,
      effective: global,
    },
  }
})

async function ensureConversation(id: string) {
  loading.value = true
  errorText.value = ''
  try {
    await bootstrapAppData()
    await loadLorebookNameMap()
    let res = await fetch(`/api/chat/conversations/${id}`)
    if (res.status === 404) {
      const created = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: id,
          title: t('chat.newConversation'),
        }),
      })
      if (!created.ok) {
        errorText.value = t('chatConversation.loadFailed')
        return
      }
      const defaultLorebookIds = await fetchDefaultLorebookIds()
      if (defaultLorebookIds.length > 0) {
        await fetch(`/api/chat/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lorebookIds: defaultLorebookIds }),
        })
      }
      res = await fetch(`/api/chat/conversations/${id}`)
    }
    if (!res.ok) {
      errorText.value = t('chatConversation.loadFailed')
      return
    }
    const idx = (await res.json()) as Record<string, unknown>
    title.value = typeof idx.title === 'string' ? idx.title : t('chat.newConversation')
    hasConversationTurns.value =
      typeof idx.headChunkFile === 'string' && idx.headChunkFile.length > 0
    applyConversationMemoryIndexMeta(idx)
    convBindings.value = bindingsFromIndex(idx)
    void patchPromptDebugMaxToServer(id)
    maybePromptMemoryRebuild()
  } catch {
    errorText.value = t('chatConversation.loadFailed')
  } finally {
    loading.value = false
  }
}

async function saveTitle() {
  const id = props.conversationId
  const next = title.value.trim()
  if (!next) {
    title.value = t('chat.newConversation')
    return
  }
  titleSaving.value = true
  try {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    })
    if (res.ok) {
      const j = (await res.json()) as { index?: { title?: string } }
      if (j.index?.title) title.value = j.index.title
    }
  } finally {
    titleSaving.value = false
  }
}

watch(
  () => props.conversationId,
  (id) => {
    memoryRebuildDismissKey = ''
    memoryRebuildDialogOpen.value = false
    void ensureConversation(id)
  },
  { immediate: true },
)

/** 偏好变更时同步会话索引中的 prompt 快照开关（maxStored=0 表示不写） */
watch(
  () =>
    [
      props.conversationId,
      prefStore.writeChatPromptSnapshot,
      prefStore.promptDebugMaxStored,
    ] as const,
  ([id]) => {
    if (!id || loading.value) return
    void patchPromptDebugMaxToServer(id)
  },
)

watch([embeddingModel, embeddingDimensions], () => {
  if (loading.value) return
  maybePromptMemoryRebuild()
})

watch(
  () => convBindings.value.memory.effective.memoryEnabled,
  () => {
    if (loading.value) return
    maybePromptMemoryRebuild()
  },
)
</script>

<template>
  <div
    class="chat_pane app-page-shell"
    :class="{ 'chat_pane--state': loading || !!errorText }"
  >
    <div
      v-if="loading"
      class="chat-body chat-body--state pa-4 text-body-2 text-medium-emphasis"
    >
      {{ $t('chatConversation.loading') }}
    </div>
    <div
      v-else-if="errorText"
      class="chat-body chat-body--state pa-4"
    >
      <v-alert type="error" variant="tonal" density="compact">
        {{ errorText }}
      </v-alert>
      <v-btn class="mt-4" variant="text" @click="router.push({ name: 'home' })">
        {{ $t('chatConversation.backHome') }}
      </v-btn>
    </div>
    <template v-else>
      <header class="chat-header">
        <v-btn
          icon="mdi-arrow-left"
          variant="text"
          density="comfortable"
          size="small"
          class="chat-header__back"
          :aria-label="$t('chatConversation.backHome')"
          @click="router.push({ name: 'home' })"
        />
        <div class="chat-header__title-wrap">
          <input
            v-model="title"
            type="text"
            class="chat-header__title-input"
            :placeholder="$t('chat.newConversation')"
            :disabled="titleSaving"
            @blur="saveTitle"
            @keydown.enter.prevent="($event.target as HTMLInputElement)?.blur()"
          />
          <v-progress-circular
            v-if="titleSaving"
            indeterminate
            size="14"
            width="2"
            class="chat-header__saving"
          />
        </div>
        <div class="chat-header__meta">
          <v-btn
            icon="mdi-cog-outline"
            variant="text"
            density="comfortable"
            size="small"
            class="chat-header__settings"
            :aria-label="$t('chat.convSettings.openButton')"
            @click="convContextSettingsRef?.open()"
          />
          <span
            v-if="!conn.isApiKeyConfigured"
            class="chat-header__pill chat-header__pill--warning"
          >
            <span class="chat-header__dot chat-header__dot--warning" />
            {{ $t('chat.hintConfigureApi') }}
          </span>
          <template v-else>
            <span
              v-if="conn.model.trim()"
              class="chat-header__pill chat-header__pill--accent"
            >
              <span class="chat-header__dot" />
              {{ conn.model.trim() }}
            </span>
            <span
              v-if="conn.alias.trim()"
              class="chat-header__pill"
            >
              {{ conn.alias.trim() }}
            </span>
            <span
              v-for="name in boundLorebookLabels"
              :key="name"
              class="chat-header__pill chat-header__pill--lorebook"
              :title="$t('chatConversation.boundLorebook')"
            >
              <v-icon
                icon="mdi-book-open-page-variant-outline"
                size="14"
                class="mr-1"
              />
              {{ name }}
            </span>
          </template>
        </div>
      </header>
      <HomeChat
        :conversation-id="conversationId"
        :conversation-prompt-preset-id="convBindings.promptPresetId"
        :conversation-character-ids="convBindings.characterIds"
        :conversation-lorebook-ids="convBindings.lorebookIds"
        :conversation-user-name="convBindings.userName"
        :conversation-user-character-id="convBindings.userCharacterId"
      />
      <v-dialog
        v-model="memoryRebuildDialogOpen"
        max-width="32rem"
        persistent
      >
        <v-card>
          <v-card-title class="text-body-1 font-weight-medium">
            {{ $t('chatConversation.memoryRebuildTitle') }}
          </v-card-title>
          <v-card-text>
            <p class="text-body-2 mb-3">
              {{ $t('chatConversation.memoryRebuildBody') }}
            </p>
            <div class="text-body-2 text-medium-emphasis">
              <div v-if="conversationMemoryEmbeddingModel">
                {{ $t('chatConversation.memoryRebuildStoredModel') }}:
                <code>{{ conversationMemoryEmbeddingModel }}</code>
              </div>
              <div v-else>
                {{ $t('chatConversation.memoryRebuildStoredUnknown') }}
              </div>
              <div class="mt-1">
                {{ $t('chatConversation.memoryRebuildCurrentModel') }}:
                <code>{{ embeddingModel }}</code>
                <template v-if="embeddingDimensions != null">
                  · {{ embeddingDimensions }}d
                </template>
              </div>
            </div>
            <v-alert
              v-if="memoryRebuildError"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-3"
            >
              {{ memoryRebuildError }}
            </v-alert>
            <div
              v-if="memoryRebuildLoading"
              class="mt-3"
            >
              <div class="text-body-2 text-medium-emphasis mb-1">
                {{
                  $t('chatConversation.memoryRebuildProgress', {
                    done: memoryRebuildDone,
                    total: memoryRebuildTotal,
                  })
                }}
              </div>
              <div
                v-if="memoryRebuildTotal > 0"
                class="text-caption text-medium-emphasis mb-2"
              >
                {{
                  $t('chatConversation.memoryRebuildProgressDetail', {
                    turns: memoryRebuildTurns,
                    loreEntries: memoryRebuildLoreEntries,
                  })
                }}
              </div>
              <v-progress-linear
                :model-value="memoryRebuildTotal > 0 ? memoryRebuildPercent : undefined"
                :indeterminate="memoryRebuildTotal < 1"
                height="8"
                rounded
                color="primary"
              />
            </div>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              variant="text"
              :disabled="memoryRebuildLoading"
              @click="dismissMemoryRebuild"
            >
              {{ $t('chatConversation.memoryRebuildLater') }}
            </v-btn>
            <v-btn
              color="primary"
              variant="flat"
              :loading="memoryRebuildLoading"
              @click="confirmMemoryRebuild"
            >
              {{ $t('chatConversation.memoryRebuildConfirm') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      <ConversationContextSettings
        ref="convContextSettingsRef"
        :conversation-id="conversationId"
        :initial-prompt-preset-id="convBindings.promptPresetId"
        :initial-character-ids="convBindings.characterIds"
        :initial-lorebook-ids="convBindings.lorebookIds"
        :initial-lorebook-settings-use-global="convBindings.lorebook.useGlobal"
        :global-lore-recursive-enabled="lorebookRecursiveEnabled"
        :global-lore-max-recursion-depth="lorebookMaxRecursionDepth"
        :initial-lorebook-recursive-enabled="convBindings.lorebook.effective.recursiveEnabled"
        :initial-lorebook-max-recursion-depth="convBindings.lorebook.effective.maxRecursionDepth"
        :initial-history-settings-use-global="convBindings.history.useGlobal"
        :global-history-limit-enabled="historyLimitEnabled"
        :global-history-max-turns="historyMaxTurns"
        :initial-history-limit-enabled="convBindings.history.effective.limitEnabled"
        :initial-history-max-turns="convBindings.history.effective.maxTurns"
        :initial-memory-settings-use-global="convBindings.memory.useGlobal"
        :global-memory-enabled="memoryEnabled"
        :global-memory-top-k="memoryTopK"
        :initial-memory-enabled="convBindings.memory.effective.memoryEnabled"
        :initial-memory-top-k="convBindings.memory.effective.memoryTopK"
        :global-embedding-model="embeddingModel"
        :conversation-memory-embedding-model="conversationMemoryEmbeddingModel"
        :initial-user-name="convBindings.userName"
        :initial-user-character-id="convBindings.userCharacterId"
        @patched="onConvContextPatched"
        @memory-rebuilt="onMemoryRebuiltFromSettings"
      />
    </template>
  </div>
</template>

<style scoped>
.chat_pane {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: minmax(0, 1fr);
  height: calc(100vh - var(--header-height) - var(--footer-height));
  min-height: 0;
  flex: 1 1 auto;
}

.chat_pane--state {
  grid-template-rows: 1fr;
}

.chat-body--state {
  min-height: 0;
  overflow: auto;
}

/* ========== Chat Header · Tavern × Linear ========== */
.chat-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 0.25rem 0.75rem;
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
  min-width: 0;
}

.chat-header__back {
  color: rgba(var(--v-theme-on-surface), 0.7) !important;
}

.chat-header__title-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.chat-header__title-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  font-family: var(--font-display);
  font-size: 1.1875rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
  letter-spacing: 0.005em;
  padding: 0.25rem 0.375rem;
  border-radius: 0.25rem;
  outline: none;
  transition: background 0.15s;
}
.chat-header__title-input:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.chat-header__title-input:focus {
  background: rgba(var(--v-theme-on-surface), 0.04);
  box-shadow: inset 0 -0.0625rem 0 rgba(var(--v-theme-primary), 0.6);
}
.chat-header__title-input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-style: italic;
}
.chat-header__title-input:disabled {
  opacity: 0.5;
}

.chat-header__saving {
  color: rgb(var(--v-theme-primary)) !important;
}

.chat-header__meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
}

.chat-header__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.1875rem 0.5625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: var(--radius-sm);
  background: rgb(var(--v-theme-surface-light));
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.chat-header__pill--accent {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
}
.chat-header__pill--warning {
  border-color: rgba(var(--v-theme-warning), 0.5);
  background: rgba(var(--v-theme-warning), 0.08);
  color: rgb(var(--v-theme-warning));
  font-family: var(--font-ui);
  font-size: 0.71875rem;
  letter-spacing: 0;
  text-transform: none;
}

.chat-header__dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: rgb(var(--v-theme-success, 122 143 106));
  box-shadow: 0 0 0 0.1875rem rgb(var(--v-theme-success, 122 143 106) / 0.18);
  flex-shrink: 0;
}
.chat-header__dot--warning {
  background: rgb(var(--v-theme-warning));
  box-shadow: 0 0 0 0.1875rem rgba(var(--v-theme-warning), 0.18);
}
</style>
