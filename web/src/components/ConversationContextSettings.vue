<script setup lang="ts">
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
const errorText = ref('')

interface CharItem {
  id: string
  name: string
}

const charItems = ref<CharItem[]>([])
const charItemsLoading = ref(false)

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

function syncFromProps() {
  errorText.value = ''
  presetModel.value = propsPresetTarget() ?? INHERIT_VALUE
  characterModel.value = [...props.initialCharacterIds]
}

watch(
  () => [
    props.conversationId,
    props.initialPromptPresetId,
    props.initialCharacterIds,
    props.initialLorebookIds,
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

onMounted(() => {
  syncFromProps()
  void promptsStore.loadFromServer().catch(() => {})
  void loadCharacters()
})

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
            {{ $t('chat.convSettings.userNameSnapshot', { name: initialUserName }) }}
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
          <p class="text-caption text-medium-emphasis mb-1">
            {{ $t('chat.convSettings.lorebooks') }}
          </p>
          <v-alert
            type="info"
            variant="tonal"
            density="compact"
            class="mb-0"
          >
            {{ $t('chat.convSettings.lorebooksHint') }}
          </v-alert>
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
</style>
