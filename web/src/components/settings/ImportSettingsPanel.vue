<script setup lang="ts">
import { useUiContextStore } from '@/stores/ui-context'
import { useAuthStore } from '@/stores/auth'
import { characterImageUrl } from '@/utils/authenticated-media-url'
import { generateConversationId } from '@/utils/conversation-id'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const uiContext = useUiContextStore()
const auth = useAuthStore()
const router = useRouter()

interface CharacterItem {
  id: string
  name: string
  summary: string
  descriptionPreview: string
  personalityPreview: string
  tags: string[]
}

interface StLorePreview {
  name: string
  entryCount: number
  vectorEntryCount: number
  disabledCount: number
  warnings: string[]
}

interface StChatPreview {
  turnCount: number
  openingPreview: string
  warnings: string[]
  suggestedTitle: string
}

const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref<'success' | 'error'>('success')
const snackbarAction = ref<'lore' | 'chat' | null>(null)
const snackbarTargetId = ref('')

const loreFileRef = ref<HTMLInputElement | null>(null)
const chatFileRef = ref<HTMLInputElement | null>(null)

const loreDoing = ref(false)
const loreConfirmOpen = ref(false)
const lorePreview = ref<StLorePreview | null>(null)
const lorePendingFile = ref<File | null>(null)
const loreNameDraft = ref('')

const chatDoing = ref(false)
const chatConfirmOpen = ref(false)
const chatPreview = ref<StChatPreview | null>(null)
const chatPendingFile = ref<File | null>(null)
const chatTitleDraft = ref('')
const chatUserId = ref<string | null>(null)
const chatCharId = ref<string | null>(null)
const charItems = ref<CharacterItem[]>([])
const charItemsLoading = ref(false)
const chatCharacterSearch = ref('')

const canImportChat = computed(
  () =>
    Boolean(
      chatTitleDraft.value.trim() &&
        chatUserId.value &&
        chatCharId.value &&
        chatPreview.value &&
        chatPreview.value.turnCount > 0,
    ) && !chatDoing.value,
)

const filteredCharacterItems = computed(() => {
  const q = chatCharacterSearch.value.trim().toLowerCase()
  if (!q) return charItems.value
  return charItems.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.summary.toLowerCase().includes(q) ||
      c.descriptionPreview.toLowerCase().includes(q) ||
      c.personalityPreview.toLowerCase().includes(q) ||
      c.tags.some((tag) => tag.toLowerCase().includes(q)),
  )
})

function openStPresetImport() {
  uiContext.requestOpenPromptsImport()
}

function pickLoreFile() {
  loreFileRef.value?.click()
}

function pickChatFile() {
  chatFileRef.value?.click()
}

async function loadCharacters() {
  if (charItemsLoading.value || charItems.value.length > 0) return
  charItemsLoading.value = true
  try {
    const all: {
      id?: string
      name?: string
      summary?: string
      descriptionPreview?: string
      personalityPreview?: string
      tags?: unknown
    }[] = []
    let offset = 0
    const limit = 100
    for (;;) {
      const res = await fetch(`/api/characters?limit=${limit}&offset=${offset}`)
      if (!res.ok) return
      const j = (await res.json()) as {
        items?: typeof all
        hasMore?: boolean
      }
      const items = j.items ?? []
      all.push(...items)
      if (!j.hasMore || items.length === 0) break
      offset += items.length
    }
    charItems.value = all
      .filter((x) => typeof x.id === 'string' && x.id.trim())
      .map((x) => ({
        id: x.id as string,
        name:
          typeof x.name === 'string' && x.name.trim()
            ? x.name.trim()
            : (x.id as string),
        summary: typeof x.summary === 'string' ? x.summary : '',
        descriptionPreview:
          typeof x.descriptionPreview === 'string' ? x.descriptionPreview : '',
        personalityPreview:
          typeof x.personalityPreview === 'string'
            ? x.personalityPreview
            : '',
        tags: Array.isArray(x.tags)
          ? x.tags.map((tag) => String(tag).trim()).filter(Boolean)
          : [],
      }))
  } finally {
    charItemsLoading.value = false
  }
}

function characterImage(id: string): string {
  return (
    characterImageUrl(auth.user?.id ?? auth.defaultUserId, id, { size: 's' }) ??
    ''
  )
}

function shortText(text: string, max = 96): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function selectChatUser(id: string) {
  chatUserId.value = id
}

function selectChatCharacter(id: string) {
  chatCharId.value = id
}

function showSnackbar(
  text: string,
  color: 'success' | 'error',
  action: 'lore' | 'chat' | null = null,
  targetId = '',
) {
  snackbarText.value = text
  snackbarColor.value = color
  snackbarAction.value = action
  snackbarTargetId.value = targetId
  snackbar.value = true
}

async function extractApiError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: string }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

function mapErrorCode(code: string | null): string {
  if (!code) return t('settings.importFailed')
  const key = `settings.importError_${code}`
  const translated = t(key)
  return translated !== key ? translated : t('settings.importFailed')
}

async function onLoreFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  loreDoing.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/lorebooks/import-st/preview', {
      method: 'POST',
      body: fd,
    })
    if (!res.ok) {
      showSnackbar(mapErrorCode(await extractApiError(res)), 'error')
      return
    }
    const preview = (await res.json()) as StLorePreview
    lorePendingFile.value = file
    lorePreview.value = preview
    loreNameDraft.value = preview.name
    loreConfirmOpen.value = true
  } catch {
    showSnackbar(t('settings.importFailed'), 'error')
  } finally {
    loreDoing.value = false
  }
}

async function confirmLoreImport() {
  const file = lorePendingFile.value
  if (!file) return
  loreDoing.value = true
  try {
    const text = await file.text()
    const source = JSON.parse(text) as unknown
    const res = await fetch('/api/lorebooks/import-st', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source,
        name: loreNameDraft.value.trim() || undefined,
      }),
    })
    if (!res.ok) {
      showSnackbar(mapErrorCode(await extractApiError(res)), 'error')
      return
    }
    const j = (await res.json()) as { id?: string }
    loreConfirmOpen.value = false
    lorePendingFile.value = null
    showSnackbar(
      t('settings.importSuccess'),
      'success',
      'lore',
      typeof j.id === 'string' ? j.id : '',
    )
  } catch {
    showSnackbar(t('settings.importFailed'), 'error')
  } finally {
    loreDoing.value = false
  }
}

async function onChatFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  chatDoing.value = true
  try {
    void loadCharacters()
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/chat/import-st/preview', {
      method: 'POST',
      body: fd,
    })
    if (!res.ok) {
      showSnackbar(mapErrorCode(await extractApiError(res)), 'error')
      return
    }
    const preview = (await res.json()) as StChatPreview
    chatPendingFile.value = file
    chatPreview.value = preview
    chatTitleDraft.value = preview.suggestedTitle
    chatConfirmOpen.value = true
  } catch {
    showSnackbar(t('settings.importFailed'), 'error')
  } finally {
    chatDoing.value = false
  }
}

async function confirmChatImport() {
  const file = chatPendingFile.value
  const userId = chatUserId.value
  const charId = chatCharId.value
  if (!file || !userId || !charId) return
  chatDoing.value = true
  const conversationId = generateConversationId()
  let created = false
  try {
    const createRes = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        title: chatTitleDraft.value.trim(),
      }),
    })
    if (!createRes.ok) throw new Error(await createRes.text())
    created = true

    const userItem = charItems.value.find((c) => c.id === userId)
    const patchRes = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userCharacterId: userId,
        userName: userItem?.name ?? userId,
        characterIds: [charId],
      }),
    })
    if (!patchRes.ok) throw new Error(await patchRes.text())

    const fd = new FormData()
    fd.append('conversationId', conversationId)
    fd.append('file', file)
    const importRes = await fetch('/api/chat/import-st', {
      method: 'POST',
      body: fd,
    })
    if (!importRes.ok) {
      const code = await extractApiError(importRes)
      if (created) {
        await fetch(`/api/chat/conversations/${conversationId}`, {
          method: 'DELETE',
        }).catch(() => {})
        created = false
      }
      showSnackbar(mapErrorCode(code), 'error')
      return
    }

    chatConfirmOpen.value = false
    chatPendingFile.value = null
    showSnackbar(t('settings.importSuccess'), 'success', 'chat', conversationId)
  } catch {
    if (created) {
      await fetch(`/api/chat/conversations/${conversationId}`, {
        method: 'DELETE',
      }).catch(() => {})
    }
    showSnackbar(t('settings.importFailed'), 'error')
  } finally {
    chatDoing.value = false
  }
}

function onSnackbarAction() {
  if (snackbarAction.value === 'lore') {
    uiContext.requestOpenLorebooksDialog(snackbarTargetId.value || null)
  } else if (snackbarAction.value === 'chat' && snackbarTargetId.value) {
    void router.push({
      name: 'chat',
      params: { conversationId: snackbarTargetId.value },
    })
  }
  snackbar.value = false
}
</script>

<template>
  <section class="settings-section import-settings-panel">
    <p class="text-body-2 text-medium-emphasis mb-4">
      {{ t('settings.importIntro') }}
    </p>

    <v-card class="mb-4" variant="outlined" rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-medium">
        {{ t('settings.importStChatTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ t('settings.importStChatHint') }}
        </p>
        <v-btn
          color="primary"
          variant="tonal"
          :loading="chatDoing"
          @click="pickChatFile"
        >
          {{ t('settings.importStChatAction') }}
        </v-btn>
        <input
          ref="chatFileRef"
          type="file"
          accept=".jsonl,application/jsonl,text/plain,application/json"
          class="d-none"
          @change="onChatFileChange"
        >
      </v-card-text>
    </v-card>

    <v-card class="mb-4" variant="outlined" rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-medium">
        {{ t('settings.importStLoreTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ t('settings.importStLoreHint') }}
        </p>
        <v-btn
          color="primary"
          variant="tonal"
          :loading="loreDoing"
          @click="pickLoreFile"
        >
          {{ t('settings.importStLoreAction') }}
        </v-btn>
        <input
          ref="loreFileRef"
          type="file"
          accept=".json,application/json"
          class="d-none"
          @change="onLoreFileChange"
        >
      </v-card-text>
    </v-card>

    <v-card variant="outlined" rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-medium">
        {{ t('settings.importStPresetTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ t('settings.importStPresetHint') }}
        </p>
        <v-btn color="primary" variant="tonal" @click="openStPresetImport">
          {{ t('settings.importStPresetAction') }}
        </v-btn>
      </v-card-text>
    </v-card>

    <!-- lorebook confirm -->
    <v-dialog v-model="loreConfirmOpen" max-width="28rem">
      <v-card>
        <v-card-title>{{ t('settings.importStLoreConfirmTitle') }}</v-card-title>
        <v-card-text v-if="lorePreview">
          <p class="text-body-2 mb-3">
            {{
              t('settings.importStLoreConfirmBody', {
                name: loreNameDraft || lorePreview.name,
                count: lorePreview.entryCount,
                vector: lorePreview.vectorEntryCount,
                disabled: lorePreview.disabledCount,
              })
            }}
          </p>
          <v-text-field
            v-model="loreNameDraft"
            :label="t('lorebooks.bookLabel')"
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
          />
          <ul
            v-if="lorePreview.warnings.length"
            class="text-caption text-medium-emphasis pl-4"
          >
            <li v-for="(w, i) in lorePreview.warnings" :key="i">{{ w }}</li>
          </ul>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="loreDoing"
            @click="loreConfirmOpen = false"
          >
            {{ t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="loreDoing"
            @click="confirmLoreImport"
          >
            {{ t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- chat confirm -->
    <v-dialog v-model="chatConfirmOpen" max-width="32rem">
      <v-card>
        <v-card-title>{{ t('settings.importStChatConfirmTitle') }}</v-card-title>
        <v-card-text v-if="chatPreview">
          <p class="text-body-2 mb-3">
            {{
              t('settings.importStChatConfirmBody', {
                count: chatPreview.turnCount,
              })
            }}
          </p>
          <v-text-field
            v-model="chatTitleDraft"
            :label="t('settings.importStChatTitleLabel')"
            density="compact"
            variant="outlined"
            class="mb-2"
          />
          <v-text-field
            v-model="chatCharacterSearch"
            :label="t('settings.importCharacterSearch')"
            density="compact"
            variant="outlined"
            prepend-inner-icon="mdi-magnify"
            hide-details
            class="mb-3"
            @focus="loadCharacters"
          />

          <div class="import-character-picker">
            <div class="import-character-picker__head">
              <span>{{ t('settings.importStChatUserLabel') }}</span>
              <span class="text-caption text-medium-emphasis">
                {{ t('settings.importSelectCharacter') }}
              </span>
            </div>
            <div class="import-character-grid">
              <button
                v-for="item in filteredCharacterItems"
                :key="`user-${item.id}`"
                type="button"
                class="import-character-card"
                :class="{ 'is-selected': chatUserId === item.id }"
                @click="selectChatUser(item.id)"
              >
                <img
                  class="import-character-card__avatar"
                  :src="characterImage(item.id)"
                  alt=""
                  loading="lazy"
                >
                <div class="import-character-card__body">
                  <div class="import-character-card__title">
                    {{ item.name }}
                  </div>
                  <div
                    v-if="item.tags.length"
                    class="import-character-card__tags"
                  >
                    <span
                      v-for="tag in item.tags.slice(0, 3)"
                      :key="tag"
                      class="import-character-card__tag"
                    >{{ tag }}</span>
                  </div>
                  <p
                    v-if="item.descriptionPreview || item.summary"
                    class="import-character-card__text"
                  >
                    {{ t('settings.importCharacterDescription') }}：{{
                      shortText(item.descriptionPreview || item.summary)
                    }}
                  </p>
                  <p
                    v-if="item.personalityPreview"
                    class="import-character-card__text"
                  >
                    {{ t('settings.importCharacterPersonality') }}：{{
                      shortText(item.personalityPreview)
                    }}
                  </p>
                </div>
              </button>
              <p
                v-if="!charItemsLoading && filteredCharacterItems.length === 0"
                class="text-caption text-medium-emphasis pa-2"
              >
                {{ t('settings.importNoCharacters') }}
              </p>
            </div>
          </div>

          <div class="import-character-picker">
            <div class="import-character-picker__head">
              <span>{{ t('settings.importStChatCharLabel') }}</span>
              <span class="text-caption text-medium-emphasis">
                {{ t('settings.importSelectCharacter') }}
              </span>
            </div>
            <div class="import-character-grid">
              <button
                v-for="item in filteredCharacterItems"
                :key="`char-${item.id}`"
                type="button"
                class="import-character-card"
                :class="{ 'is-selected': chatCharId === item.id }"
                @click="selectChatCharacter(item.id)"
              >
                <img
                  class="import-character-card__avatar"
                  :src="characterImage(item.id)"
                  alt=""
                  loading="lazy"
                >
                <div class="import-character-card__body">
                  <div class="import-character-card__title">
                    {{ item.name }}
                  </div>
                  <div
                    v-if="item.tags.length"
                    class="import-character-card__tags"
                  >
                    <span
                      v-for="tag in item.tags.slice(0, 3)"
                      :key="tag"
                      class="import-character-card__tag"
                    >{{ tag }}</span>
                  </div>
                  <p
                    v-if="item.descriptionPreview || item.summary"
                    class="import-character-card__text"
                  >
                    {{ t('settings.importCharacterDescription') }}：{{
                      shortText(item.descriptionPreview || item.summary)
                    }}
                  </p>
                  <p
                    v-if="item.personalityPreview"
                    class="import-character-card__text"
                  >
                    {{ t('settings.importCharacterPersonality') }}：{{
                      shortText(item.personalityPreview)
                    }}
                  </p>
                </div>
              </button>
              <p
                v-if="!charItemsLoading && filteredCharacterItems.length === 0"
                class="text-caption text-medium-emphasis pa-2"
              >
                {{ t('settings.importNoCharacters') }}
              </p>
            </div>
          </div>
          <p
            v-if="chatPreview.openingPreview"
            class="text-caption text-medium-emphasis mb-2"
          >
            {{ t('settings.importStChatOpeningPreview') }}：{{
              chatPreview.openingPreview
            }}
          </p>
          <ul
            v-if="chatPreview.warnings.length"
            class="text-caption text-warning pl-4"
          >
            <li v-for="(w, i) in chatPreview.warnings" :key="i">{{ w }}</li>
          </ul>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="chatDoing"
            @click="chatConfirmOpen = false"
          >
            {{ t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="chatDoing"
            :disabled="!canImportChat"
            @click="confirmChatImport"
          >
            {{ t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :timeout="6000" :color="snackbarColor">
      {{ snackbarText }}
      <template v-if="snackbarAction" #actions>
        <v-btn variant="text" @click="onSnackbarAction">
          {{
            snackbarAction === 'lore'
              ? t('settings.importOpenLorebooks')
              : t('settings.importOpenChat')
          }}
        </v-btn>
      </template>
    </v-snackbar>
  </section>
</template>

<style scoped>
.import-character-picker {
  margin-bottom: 0.875rem;
}

.import-character-picker__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
}

.import-character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.5rem;
  max-height: 17rem;
  overflow: auto;
  padding: 0.125rem;
}

.import-character-card {
  display: grid;
  grid-template-columns: 3.5rem minmax(0, 1fr);
  gap: 0.625rem;
  width: 100%;
  padding: 0.625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 0.875rem;
  background: rgba(var(--v-theme-surface), 0.96);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;
}

.import-character-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-primary), 0.06);
}

.import-character-card.is-selected {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
  box-shadow: 0 0 0 0.125rem rgba(var(--v-theme-primary), 0.12);
}

.import-character-card__avatar {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 0.75rem;
  object-fit: cover;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.import-character-card__body {
  min-width: 0;
}

.import-character-card__title {
  overflow: hidden;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-character-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}

.import-character-card__tag {
  max-width: 7rem;
  overflow: hidden;
  padding: 0.0625rem 0.375rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-size: 0.6875rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-character-card__text {
  display: -webkit-box;
  overflow: hidden;
  margin: 0.25rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.75rem;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
