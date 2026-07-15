<script setup lang="ts">
import { fileLibraryContentUrl } from '@/utils/authenticated-media-url'
import { useAuthStore } from '@/stores/auth'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  kind: 'image' | 'audio'
  fileId: string | null
  label: string
  hint?: string
  disabled?: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:fileId', fileId: string | null): void
}>()

const auth = useAuthStore()

interface LibraryItem {
  fileId: string
  name: string
  kind: string
}

const pickerOpen = ref(false)
const libraryLoading = ref(false)
const libraryItems = ref<LibraryItem[]>([])
const librarySearch = ref('')
const libraryHasMore = ref(false)
const libraryOffset = ref(0)
const selectedPick = ref<string | null>(null)
const currentMeta = ref<LibraryItem | null>(null)
const metaLoading = ref(false)
let metaLoadGen = 0
let libraryFetchGen = 0

const previewSrc = computed(() => {
  if (props.kind !== 'image' || !props.fileId) return null
  return fileLibraryContentUrl(auth.user?.id, props.fileId, { size: 'm' })
})

async function loadCurrentMeta() {
  const id = props.fileId?.trim() ?? ''
  const gen = ++metaLoadGen
  if (!id) {
    currentMeta.value = null
    metaLoading.value = false
    return
  }
  metaLoading.value = true
  try {
    const res = await fetch(`/api/files/${id}`)
    if (gen !== metaLoadGen) return
    if (!res.ok) {
      currentMeta.value = {
        fileId: id,
        name: '',
        kind: props.kind,
      }
      return
    }
    const j = (await res.json()) as {
      fileId?: string
      name?: string
      kind?: string
    }
    if (gen !== metaLoadGen) return
    currentMeta.value = {
      fileId: typeof j.fileId === 'string' ? j.fileId : id,
      name: typeof j.name === 'string' ? j.name : '',
      kind: typeof j.kind === 'string' ? j.kind : props.kind,
    }
  } catch {
    if (gen !== metaLoadGen) return
    currentMeta.value = { fileId: id, name: '', kind: props.kind }
  } finally {
    if (gen === metaLoadGen) metaLoading.value = false
  }
}

watch(
  () => props.fileId,
  () => {
    void loadCurrentMeta()
  },
  { immediate: true },
)

async function fetchLibrary(reset: boolean) {
  const gen = reset ? ++libraryFetchGen : libraryFetchGen
  libraryLoading.value = true
  try {
    if (reset) {
      libraryOffset.value = 0
      libraryItems.value = []
    }
    const offset = libraryOffset.value
    const q = new URLSearchParams({
      kind: props.kind,
      limit: '24',
      offset: String(offset),
    })
    const search = librarySearch.value.trim()
    if (search) q.set('search', search)
    const res = await fetch(`/api/files?${q}`)
    if (gen !== libraryFetchGen) return
    if (!res.ok) return
    const j = (await res.json()) as {
      items?: LibraryItem[]
      hasMore?: boolean
    }
    const items = Array.isArray(j.items) ? j.items : []
    if (gen !== libraryFetchGen) return
    libraryItems.value = reset ? items : [...libraryItems.value, ...items]
    libraryOffset.value = offset + items.length
    libraryHasMore.value = j.hasMore === true
  } finally {
    if (gen === libraryFetchGen) libraryLoading.value = false
  }
}

function openPicker() {
  selectedPick.value = props.fileId
  librarySearch.value = ''
  pickerOpen.value = true
  void fetchLibrary(true)
}

function clearLibrarySearch() {
  librarySearch.value = ''
  void fetchLibrary(true)
}

function confirmPicker() {
  emit('update:fileId', selectedPick.value)
  pickerOpen.value = false
}

function clearSelection() {
  emit('update:fileId', null)
}

function kindIcon(kind: string): string {
  switch (kind) {
    case 'image':
      return 'mdi-image-outline'
    case 'audio':
      return 'mdi-music-note'
    default:
      return 'mdi-file-outline'
  }
}

function pickPreviewUrl(fileId: string, kind: string): string | null {
  if (kind !== 'image') return null
  return fileLibraryContentUrl(auth.user?.id, fileId, { size: 'm' })
}
</script>

<template>
  <div class="cmf-field">
    <div class="cmf-field__label text-body-2">
      {{ label }}
    </div>
    <div
      v-if="fileId"
      class="cmf-current"
    >
      <div class="cmf-current__thumb">
        <img
          v-if="previewSrc"
          :src="previewSrc"
          alt=""
          class="cmf-current__img"
        >
        <v-icon
          v-else
          size="28"
          class="cmf-current__icon"
        >
          {{ currentMeta?.name ? kindIcon(kind) : 'mdi-link-off' }}
        </v-icon>
      </div>
      <div class="cmf-current__meta min-w-0">
        <span class="cmf-current__name text-truncate">
          {{
            metaLoading
              ? $t('chat.convSettings.mediaLoading')
              : currentMeta?.name || $t('chat.convSettings.mediaMissing')
          }}
        </span>
        <span class="cmf-current__id text-truncate">{{ fileId }}</span>
      </div>
      <v-btn
        icon="mdi-close"
        size="small"
        variant="text"
        :disabled="disabled || saving"
        :aria-label="$t('chat.convSettings.mediaClear')"
        @click="clearSelection"
      />
    </div>
    <div
      v-else
      class="cmf-empty text-caption text-medium-emphasis"
    >
      {{ $t('chat.convSettings.mediaNone') }}
    </div>
    <div class="cmf-actions">
      <v-btn
        size="small"
        variant="tonal"
        :loading="saving"
        :disabled="disabled"
        @click="openPicker"
      >
        {{ fileId ? $t('chat.convSettings.mediaChange') : $t('chat.convSettings.mediaPick') }}
      </v-btn>
    </div>
    <p
      v-if="hint"
      class="cmf-hint"
    >
      {{ hint }}
    </p>

    <v-dialog
      v-model="pickerOpen"
      max-width="640"
      scrollable
    >
      <v-card>
        <v-card-title>{{ label }}</v-card-title>
        <v-card-text class="scroll-y-nice cmf-picker-body">
          <v-text-field
            v-model="librarySearch"
            :label="$t('chat.convSettings.mediaSearch')"
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
            clearable
            @keyup.enter="fetchLibrary(true)"
            @click:clear="clearLibrarySearch"
          />
          <div
            v-if="libraryLoading && !libraryItems.length"
            class="text-caption"
          >
            {{ $t('chat.convSettings.mediaLoading') }}
          </div>
          <div
            v-if="libraryItems.length"
            class="cmf-grid"
          >
            <button
              v-for="f in libraryItems"
              :key="f.fileId"
              type="button"
              class="cmf-card"
              :class="{ 'cmf-card--selected': selectedPick === f.fileId }"
              @click="selectedPick = f.fileId"
            >
              <div class="cmf-card__thumb">
                <img
                  v-if="pickPreviewUrl(f.fileId, f.kind)"
                  :src="pickPreviewUrl(f.fileId, f.kind) ?? undefined"
                  alt=""
                  class="cmf-card__img"
                >
                <v-icon
                  v-else
                  size="28"
                  class="cmf-card__icon"
                >
                  {{ kindIcon(f.kind) }}
                </v-icon>
                <v-icon
                  v-if="selectedPick === f.fileId"
                  class="cmf-card__check"
                  size="20"
                  color="primary"
                >
                  mdi-check-circle
                </v-icon>
              </div>
              <div class="cmf-card__meta">
                <span class="cmf-card__name text-truncate">{{ f.name }}</span>
                <span class="cmf-card__id text-truncate">{{ f.fileId }}</span>
              </div>
            </button>
          </div>
          <v-btn
            v-if="libraryHasMore"
            size="small"
            variant="text"
            class="mt-2"
            :loading="libraryLoading"
            @click="fetchLibrary(false)"
          >
            {{ $t('chat.convSettings.mediaLoadMore') }}
          </v-btn>
          <p
            v-if="!libraryLoading && !libraryItems.length"
            class="text-caption text-medium-emphasis"
          >
            {{ $t('chat.convSettings.mediaLibraryEmpty') }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-btn
            variant="text"
            :disabled="!selectedPick"
            @click="selectedPick = null"
          >
            {{ $t('chat.convSettings.mediaClear') }}
          </v-btn>
          <v-spacer />
          <v-btn
            variant="text"
            @click="pickerOpen = false"
          >
            {{ $t('chat.convSettings.mediaCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            @click="confirmPicker"
          >
            {{ $t('chat.convSettings.mediaConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.cmf-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.cmf-field__label {
  font-weight: 500;
}

.cmf-current {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 0.35rem 0.35rem 0.35rem 0.35rem;
}

.cmf-current__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  flex: 0 0 auto;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.cmf-current__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cmf-current__icon {
  opacity: 0.55;
}

.cmf-current__meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  flex: 1 1 auto;
}

.cmf-current__name {
  font-size: 0.875rem;
}

.cmf-current__id {
  font-size: 0.75rem;
  opacity: 0.6;
  font-family: ui-monospace, monospace;
}

.cmf-hint {
  margin: 0;
  font-size: 0.75rem;
  opacity: 0.7;
}

.cmf-picker-body {
  max-height: 60dvh;
}

.cmf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.5rem;
}

.cmf-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  cursor: pointer;
  text-align: left;
  padding: 0;
  color: inherit;
}

.cmf-card--selected {
  border-color: rgb(var(--v-theme-primary));
}

.cmf-card__thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.cmf-card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cmf-card__icon {
  opacity: 0.55;
}

.cmf-card__check {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
}

.cmf-card__meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.35rem 0.45rem 0.45rem;
  min-width: 0;
}

.cmf-card__name {
  font-size: 0.8rem;
}

.cmf-card__id {
  font-size: 0.7rem;
  opacity: 0.6;
  font-family: ui-monospace, monospace;
}
</style>
