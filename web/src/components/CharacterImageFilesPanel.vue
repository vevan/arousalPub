<script setup lang="ts">
import { coreNotify } from '@/utils/core-notify'
import { fileLibraryContentUrl } from '@/utils/authenticated-media-url'
import { useAuthStore } from '@/stores/auth'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  characterId: string
  /** 外层已有标题时隐藏面板内标题；绑定按钮由外层提供 */
  embedded?: boolean
}>()

const { t } = useI18n()
const auth = useAuthStore()

const MAX = 30

interface BoundItem {
  fileId: string
  name: string
  kind: string
  mime: string
  contentUrl: string
  missing: boolean
}

interface ImageFilesDto {
  fileIds: string[]
  items: BoundItem[]
  nameConflict: boolean
  duplicateNameKeys: string[]
}

interface LibraryItem {
  fileId: string
  name: string
  kind: string
}

const loading = ref(false)
const saving = ref(false)
const dto = ref<ImageFilesDto | null>(null)
const pickerOpen = ref(false)
const libraryLoading = ref(false)
const libraryItems = ref<LibraryItem[]>([])
const librarySearch = ref('')
const libraryHasMore = ref(false)
/** 仅统计 API 返回条数，不含前置已绑 extras */
const libraryFetchedCount = ref(0)
const selectedPick = ref<string[]>([])

const boundIds = computed(() => dto.value?.fileIds ?? [])
const nameConflict = computed(() => dto.value?.nameConflict === true)

function kindIcon(kind: string): string {
  switch (kind) {
    case 'image':
      return 'mdi-image-outline'
    case 'document':
      return 'mdi-file-document-outline'
    case 'audio':
      return 'mdi-music-note'
    case 'video':
      return 'mdi-video-outline'
    default:
      return 'mdi-file-outline'
  }
}

function previewUrl(fileId: string, kind: string): string | null {
  if (kind !== 'image') return null
  return fileLibraryContentUrl(auth.user?.id, fileId, { size: 'm' })
}

async function loadBound() {
  loading.value = true
  try {
    const res = await fetch(`/api/characters/${props.characterId}/image-files`)
    if (!res.ok) {
      coreNotify(t('characters.imageFilesLoadFailed'), undefined, { level: 'error' })
      return
    }
    dto.value = (await res.json()) as ImageFilesDto
  } catch {
    coreNotify(t('characters.imageFilesLoadFailed'), undefined, { level: 'error' })
  } finally {
    loading.value = false
  }
}

async function saveIds(fileIds: string[]): Promise<boolean> {
  saving.value = true
  try {
    const res = await fetch(`/api/characters/${props.characterId}/image-files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        detail?: string
      }
      const code = body.error ?? ''
      if (code === 'image_files_name_conflict') {
        coreNotify(
          t('characters.imageFilesNameConflict', { names: body.detail ?? '' }),
          undefined,
          { level: 'error' },
        )
      } else if (code === 'image_files_too_many') {
        coreNotify(t('characters.imageFilesTooMany', { max: MAX }), undefined, {
          level: 'error',
        })
      } else {
        coreNotify(t('characters.imageFilesSaveFailed'), undefined, {
          level: 'error',
        })
      }
      return false
    }
    dto.value = (await res.json()) as ImageFilesDto
    coreNotify(t('characters.imageFilesSaved'), undefined, { level: 'success' })
    return true
  } catch {
    coreNotify(t('characters.imageFilesSaveFailed'), undefined, { level: 'error' })
    return false
  } finally {
    saving.value = false
  }
}

function removeId(fileId: string) {
  void saveIds(boundIds.value.filter((id) => id !== fileId))
}

async function fetchLibrary(reset: boolean) {
  libraryLoading.value = true
  try {
    const offset = reset ? 0 : libraryFetchedCount.value
    const q = new URLSearchParams({
      limit: '100',
      offset: String(offset),
    })
    const s = librarySearch.value.trim()
    if (s) q.set('search', s)
    const res = await fetch(`/api/files?${q}`)
    if (!res.ok) {
      coreNotify(t('characters.imageFilesLibraryFailed'), undefined, {
        level: 'error',
      })
      return
    }
    const body = (await res.json()) as {
      items?: LibraryItem[]
      hasMore?: boolean
    }
    const items = Array.isArray(body.items) ? body.items : []
    libraryFetchedCount.value = reset
      ? items.length
      : libraryFetchedCount.value + items.length
    libraryItems.value = reset ? items : [...libraryItems.value, ...items]
    libraryHasMore.value = body.hasMore === true
    if (reset) {
      const seen = new Set(libraryItems.value.map((i) => i.fileId))
      const extras: LibraryItem[] = []
      for (const b of dto.value?.items ?? []) {
        if (b.missing || seen.has(b.fileId)) continue
        if (!selectedPick.value.includes(b.fileId)) continue
        extras.push({
          fileId: b.fileId,
          name: b.name || b.fileId,
          kind: b.kind || '?',
        })
        seen.add(b.fileId)
      }
      if (extras.length) {
        libraryItems.value = [...extras, ...libraryItems.value]
      }
    }
  } catch {
    coreNotify(t('characters.imageFilesLibraryFailed'), undefined, {
      level: 'error',
    })
  } finally {
    libraryLoading.value = false
  }
}

async function openPicker() {
  selectedPick.value = (dto.value?.items ?? [])
    .filter((i) => !i.missing)
    .map((i) => i.fileId)
  librarySearch.value = ''
  libraryItems.value = []
  libraryHasMore.value = false
  libraryFetchedCount.value = 0
  pickerOpen.value = true
  await fetchLibrary(true)
}

async function confirmPicker() {
  const ok = await saveIds(selectedPick.value.slice(0, MAX))
  if (ok) pickerOpen.value = false
}

function isPickSelected(fileId: string): boolean {
  return selectedPick.value.includes(fileId)
}

function canTogglePick(fileId: string): boolean {
  if (isPickSelected(fileId)) return true
  return selectedPick.value.length < MAX
}

function togglePick(fileId: string) {
  if (!canTogglePick(fileId)) return
  if (isPickSelected(fileId)) {
    selectedPick.value = selectedPick.value.filter((id) => id !== fileId)
  } else {
    selectedPick.value = [...selectedPick.value, fileId]
  }
}

function clearLibrarySearch() {
  librarySearch.value = ''
  void fetchLibrary(true)
}

defineExpose({
  openPicker,
})

onMounted(() => {
  void loadBound()
})

watch(
  () => props.characterId,
  () => {
    void loadBound()
  },
)
</script>

<template>
  <div class="char-image-files">
    <div
      v-if="!embedded"
      class="text-subtitle-2 mb-1"
    >
      {{ $t('characters.imageFilesTitle') }}
    </div>
    <p
      v-if="!embedded"
      class="text-caption text-medium-emphasis mb-2"
    >
      {{ $t('characters.imageFilesHint', { max: MAX }) }}
    </p>
    <v-alert
      v-if="nameConflict"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-2"
    >
      {{
        $t('characters.imageFilesRenameConflict', {
          names: (dto?.duplicateNameKeys ?? []).join(', '),
        })
      }}
    </v-alert>
    <div
      v-if="loading"
      class="text-caption text-medium-emphasis"
    >
      {{ $t('characters.imageFilesLoading') }}
    </div>
    <div
      v-else-if="!(dto?.items?.length)"
      class="text-caption text-medium-emphasis mb-2"
    >
      {{ $t('characters.imageFilesEmpty') }}
    </div>
    <div
      v-else
      class="cif-grid mb-2"
    >
      <div
        v-for="item in dto?.items ?? []"
        :key="item.fileId"
        class="cif-card"
        :class="{ 'cif-card--missing': item.missing }"
      >
        <div class="cif-card__thumb">
          <img
            v-if="!item.missing && previewUrl(item.fileId, item.kind)"
            :src="previewUrl(item.fileId, item.kind) ?? undefined"
            alt=""
            class="cif-card__img"
          >
          <v-icon
            v-else
            size="28"
            class="cif-card__icon"
          >
            {{ item.missing ? 'mdi-link-off' : kindIcon(item.kind) }}
          </v-icon>
        </div>
        <div class="cif-card__meta">
          <span class="cif-card__name text-truncate">
            {{ item.missing ? $t('characters.imageFilesMissing') : item.name || item.fileId }}
          </span>
          <span class="cif-card__id text-truncate">{{ item.fileId }}</span>
        </div>
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          class="cif-card__remove"
          :disabled="saving"
          :aria-label="$t('characters.delete')"
          @click="removeId(item.fileId)"
        />
      </div>
    </div>
    <v-btn
      v-if="!embedded"
      size="small"
      variant="tonal"
      :loading="saving"
      :disabled="loading"
      @click="openPicker"
    >
      {{ $t('characters.imageFilesPick') }}
    </v-btn>

    <v-dialog
      v-model="pickerOpen"
      max-width="640"
      scrollable
    >
      <v-card class="cif-picker-card">
        <v-card-title>{{ $t('characters.imageFilesPickTitle') }}</v-card-title>
        <v-card-text class="scroll-y-nice cif-picker-body">
          <v-text-field
            v-model="librarySearch"
            :label="$t('characters.imageFilesSearch')"
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
            {{ $t('characters.imageFilesLoading') }}
          </div>
          <div
            v-if="libraryItems.length"
            class="cif-grid"
          >
            <button
              v-for="f in libraryItems"
              :key="f.fileId"
              type="button"
              class="cif-card cif-card--pick"
              :class="{
                'cif-card--selected': isPickSelected(f.fileId),
                'cif-card--disabled': !canTogglePick(f.fileId),
              }"
              :disabled="!canTogglePick(f.fileId)"
              @click="togglePick(f.fileId)"
            >
              <div class="cif-card__thumb">
                <img
                  v-if="previewUrl(f.fileId, f.kind)"
                  :src="previewUrl(f.fileId, f.kind) ?? undefined"
                  alt=""
                  class="cif-card__img"
                >
                <v-icon
                  v-else
                  size="28"
                  class="cif-card__icon"
                >
                  {{ kindIcon(f.kind) }}
                </v-icon>
                <v-icon
                  v-if="isPickSelected(f.fileId)"
                  class="cif-card__check"
                  size="20"
                  color="primary"
                >
                  mdi-check-circle
                </v-icon>
              </div>
              <div class="cif-card__meta">
                <span class="cif-card__name text-truncate">{{ f.name }}</span>
                <span class="cif-card__id text-truncate">{{ f.fileId }}</span>
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
            {{ $t('characters.imageFilesLoadMore') }}
          </v-btn>
          <p
            v-if="!libraryLoading && !libraryItems.length"
            class="text-caption text-medium-emphasis"
          >
            {{ $t('characters.imageFilesLibraryEmpty') }}
          </p>
        </v-card-text>
        <v-card-actions>
          <span class="text-caption text-medium-emphasis">
            {{ selectedPick.length }} / {{ MAX }}
          </span>
          <v-spacer />
          <v-btn
            variant="text"
            @click="pickerOpen = false"
          >
            {{ $t('characters.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            :disabled="libraryLoading || saving"
            @click="confirmPicker"
          >
            {{ $t('characters.editSave') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.cif-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
  gap: 0.5rem;
}

.cif-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

.cif-card--missing {
  border-color: rgb(var(--v-theme-error));
}

.cif-card__thumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.cif-card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cif-card__icon {
  opacity: 0.55;
}

.cif-card__meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.35rem 0.45rem 0.45rem;
  min-width: 0;
}

.cif-card__name {
  font-size: 0.75rem;
  line-height: 1.25;
  font-weight: 500;
}

.cif-card__id {
  font-size: 0.65rem;
  line-height: 1.2;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  opacity: 0.65;
}

.cif-card__remove {
  position: absolute;
  top: 0.15rem;
  right: 0.15rem;
  background: rgba(var(--v-theme-surface), 0.85) !important;
}

.cif-picker-card {
  display: flex;
  flex-direction: column;
  min-height: 50vh;
  max-height: min(90vh, calc(100dvh - 3rem));
}

.cif-picker-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.cif-card--pick {
  width: 100%;
  padding: 0;
  text-align: start;
  cursor: pointer;
  font: inherit;
  color: inherit;
  appearance: none;
}

.cif-card--pick:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.cif-card--selected {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-primary));
}

.cif-card--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cif-card__check {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  background: rgba(var(--v-theme-surface), 0.9);
  border-radius: 50%;
}
</style>
