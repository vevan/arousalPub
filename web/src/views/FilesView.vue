<script setup lang="ts">
import { fileLibraryContentUrl } from '@/utils/authenticated-media-url'
import { apiFetch } from '@/utils/api-fetch'
import { coreNotify } from '@/utils/core-notify'
import { useAuthStore } from '@/stores/auth'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  { embedded: false },
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const auth = useAuthStore()

type FileKind = 'image' | 'document' | 'audio' | 'video'

interface FileListItem {
  fileId: string
  kind: FileKind
  name: string
  mime: string
  size: number
  createdAt: string
  updatedAt: string
  tags: string[]
}

interface ListResponse {
  items: FileListItem[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

const PAGE = 24
const UPLOAD_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif,' +
  'text/plain,text/markdown,application/pdf,application/json,.txt,.md,.markdown,.pdf,.json,' +
  'audio/mpeg,audio/ogg,audio/wav,audio/aac,audio/mp4,audio/webm,.mp3,.ogg,.wav,.aac,.m4a,.webm,' +
  'video/mp4,video/webm,video/quicktime,video/ogg,.mp4,.webm,.mov,.ogv'

const items = ref<FileListItem[]>([])
const total = ref(0)
const hasMore = ref(true)
const loading = ref(false)
const loadingMore = ref(false)
const errorText = ref('')
const kind = ref<'all' | FileKind>('all')
const search = ref('')
const searchDebounced = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
/** 忽略过期的列表响应（快速切换 kind / 搜索时） */
let fetchGeneration = 0

/** Vuetify clearable 可能写出 null，统一成字符串 */
watch(
  search,
  (v) => {
    if (v == null) search.value = ''
  },
  { flush: 'sync' },
)

const selectedId = ref<string | null>(null)
const renameOpen = ref(false)
const renameDraft = ref('')
const renameDoing = ref(false)
const tagsOpen = ref(false)
const tagsDraft = ref('')
const tagsDoing = ref(false)
const deleteOpen = ref(false)
const deleteDoing = ref(false)
const uploading = ref(false)
const replacing = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const replaceInputRef = ref<HTMLInputElement | null>(null)

const selected = computed(
  () => items.value.find((i) => i.fileId === selectedId.value) ?? null,
)

const selectedPreviewUrl = computed(() => {
  if (!selected.value) return null
  return fileLibraryContentUrl(
    auth.user?.id,
    selected.value.fileId,
    { cacheBust: selected.value.updatedAt },
  )
})

function mediaUrl(fileId: string, updatedAt: string): string | null {
  return fileLibraryContentUrl(auth.user?.id, fileId, { cacheBust: updatedAt })
}

function contentPathForCopy(fileId: string): string | null {
  return fileLibraryContentUrl(auth.user?.id, fileId)
}

const selectedContentPath = computed(() =>
  selected.value ? contentPathForCopy(selected.value.fileId) : null,
)

const selectedTags = computed(() => selected.value?.tags ?? [])

const replaceAccept = computed(() => {
  const k = selected.value?.kind
  if (!k) return UPLOAD_ACCEPT
  return acceptForKind(k)
})

function acceptForKind(k: FileKind): string {
  switch (k) {
    case 'image':
      return 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif'
    case 'document':
      return 'text/plain,text/markdown,application/pdf,application/json,.txt,.md,.markdown,.pdf,.json'
    case 'audio':
      return 'audio/mpeg,audio/ogg,audio/wav,audio/aac,audio/mp4,audio/webm,.mp3,.ogg,.wav,.aac,.m4a,.webm'
    case 'video':
      return 'video/mp4,video/webm,video/quicktime,video/ogg,.mp4,.webm,.mov,.ogv'
  }
}

function normalizeListItem(raw: FileListItem): FileListItem {
  return {
    ...raw,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
  }
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function kindIcon(k: FileKind): string {
  switch (k) {
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

function kindLabel(k: FileKind): string {
  switch (k) {
    case 'image':
      return t('files.kindImage')
    case 'document':
      return t('files.kindDocument')
    case 'audio':
      return t('files.kindAudio')
    case 'video':
      return t('files.kindVideo')
  }
}

function buildQuery(offset: number): string {
  const u = new URL('/api/files', window.location.origin)
  u.searchParams.set('offset', String(offset))
  u.searchParams.set('limit', String(PAGE))
  if (kind.value !== 'all') u.searchParams.set('kind', kind.value)
  const q = String(searchDebounced.value ?? '').trim()
  if (q) u.searchParams.set('search', q)
  return u.pathname + u.search
}

async function fetchSlice(offset: number, append: boolean) {
  const gen = ++fetchGeneration
  if (append) loadingMore.value = true
  else loading.value = true
  errorText.value = ''
  try {
    const res = await apiFetch(buildQuery(offset))
    if (gen !== fetchGeneration) return
    if (!res.ok) {
      errorText.value = t('files.loadFailed')
      return
    }
    const data = (await res.json()) as ListResponse
    if (gen !== fetchGeneration) return
    const slice = (data.items ?? []).map(normalizeListItem)
    if (append) items.value = [...items.value, ...slice]
    else items.value = slice
    total.value = data.total
    hasMore.value = data.hasMore
    if (
      selectedId.value &&
      !items.value.some((i) => i.fileId === selectedId.value)
    ) {
      selectedId.value = items.value[0]?.fileId ?? null
    }
    if (!selectedId.value && items.value[0]) {
      selectedId.value = items.value[0].fileId
    }
  } catch {
    if (gen !== fetchGeneration) return
    errorText.value = t('files.loadFailed')
  } finally {
    if (gen === fetchGeneration) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function reload() {
  void fetchSlice(0, false)
}

function loadMore() {
  if (!hasMore.value || loadingMore.value || loading.value) return
  void fetchSlice(items.value.length, true)
}

watch(kind, () => reload())
watch(search, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    // clearable 会把 v-model 置为 null，不能直接 .trim()
    searchDebounced.value = typeof v === 'string' ? v : ''
    reload()
  }, 250)
})

onMounted(() => {
  reload()
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

function selectItem(id: string) {
  selectedId.value = id
}

function triggerUpload() {
  fileInputRef.value?.click()
}

function triggerReplace() {
  if (!selected.value) return
  replaceInputRef.value?.click()
}

async function onFilePicked(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file, file.name)
    const res = await apiFetch('/api/files', { method: 'POST', body: fd })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      coreNotify(
        t('files.uploadFailed'),
        body.error ? t(`api.errors.${body.error}`, body.error) : undefined,
        { level: 'error' },
      )
      return
    }
    const meta = (await res.json()) as FileListItem & { fileId: string }
    coreNotify(t('files.uploadOk'), meta.name, { level: 'success' })
    await fetchSlice(0, false)
    selectedId.value = meta.fileId
  } catch {
    coreNotify(t('files.uploadFailed'), undefined, { level: 'error' })
  } finally {
    uploading.value = false
  }
}

async function onReplacePicked(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !selected.value) return
  const fileId = selected.value.fileId
  replacing.value = true
  try {
    const fd = new FormData()
    fd.append('file', file, file.name)
    const res = await apiFetch(`/api/files/${fileId}/content`, {
      method: 'PUT',
      body: fd,
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      coreNotify(
        t('files.updateFailed'),
        body.error ? t(`api.errors.${body.error}`, body.error) : undefined,
        { level: 'error' },
      )
      return
    }
    const meta = (await res.json()) as FileListItem & { fileId: string }
    coreNotify(t('files.updateOk'), meta.name, { level: 'success' })
    await fetchSlice(0, false)
    selectedId.value = fileId
  } catch {
    coreNotify(t('files.updateFailed'), undefined, { level: 'error' })
  } finally {
    replacing.value = false
  }
}

async function copyContentPath() {
  if (!selected.value) return
  const p = contentPathForCopy(selected.value.fileId)
  if (!p) return
  try {
    await navigator.clipboard.writeText(p)
    coreNotify(t('files.pathCopied'), undefined, { level: 'success' })
  } catch {
    coreNotify(t('files.pathCopyFailed'), undefined, { level: 'error' })
  }
}

function openRename() {
  if (!selected.value) return
  renameDraft.value = selected.value.name
  renameOpen.value = true
}

async function submitRename() {
  if (!selected.value) return
  const name = renameDraft.value.trim()
  if (!name) return
  renameDoing.value = true
  try {
    const res = await apiFetch(`/api/files/${selected.value.fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      coreNotify(t('files.renameFailed'), undefined, { level: 'error' })
      return
    }
    renameOpen.value = false
    await fetchSlice(0, false)
  } catch {
    coreNotify(t('files.renameFailed'), undefined, { level: 'error' })
  } finally {
    renameDoing.value = false
  }
}

function formatTagsDraft(tags: string[]): string {
  return tags.join(', ')
}

function parseTagsDraft(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 32)
}

function openTags() {
  if (!selected.value) return
  tagsDraft.value = formatTagsDraft(selectedTags.value)
  tagsOpen.value = true
}

async function submitTags() {
  if (!selected.value) return
  const tags = parseTagsDraft(tagsDraft.value)
  tagsDoing.value = true
  try {
    const res = await apiFetch(`/api/files/${selected.value.fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags }),
    })
    if (!res.ok) {
      coreNotify(t('files.tagsFailed'), undefined, { level: 'error' })
      return
    }
    tagsOpen.value = false
    await fetchSlice(0, false)
  } catch {
    coreNotify(t('files.tagsFailed'), undefined, { level: 'error' })
  } finally {
    tagsDoing.value = false
  }
}

function openDelete() {
  if (!selected.value) return
  deleteOpen.value = true
}

async function submitDelete() {
  if (!selected.value) return
  deleteDoing.value = true
  const id = selected.value.fileId
  try {
    const res = await apiFetch(`/api/files/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      coreNotify(t('files.deleteFailed'), undefined, { level: 'error' })
      return
    }
    deleteOpen.value = false
    selectedId.value = null
    await fetchSlice(0, false)
  } catch {
    coreNotify(t('files.deleteFailed'), undefined, { level: 'error' })
  } finally {
    deleteDoing.value = false
  }
}
</script>

<template>
  <div
    class="filelib flex-grow-1 d-flex flex-column min-height-0"
    :class="{ 'filelib--embedded': props.embedded }"
  >
    <div
      class="filelib__inner"
      :class="props.embedded ? 'filelib__inner--embedded' : 'app-page-shell'"
    >
      <header
        class="library-page-head"
        :class="{ 'library-page-head--with-close': props.embedded }"
      >
        <div class="library-page-head__row">
          <h1 class="library-page-head__title">
            {{ $t('files.pageTitle') }}
          </h1>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ $t('files.lede') }}
            </p>
          </div>
          <button
            v-if="props.embedded"
            type="button"
            class="library-page-head__close"
            :aria-label="$t('app.closeModal')"
            @click="emit('close')"
          >
            <v-icon size="20">mdi-close</v-icon>
          </button>
        </div>
      </header>

      <div class="filelib-toolbar">
        <v-btn-toggle
          v-model="kind"
          mandatory
          density="compact"
          variant="outlined"
          divided
          class="filelib-kind-toggle"
        >
          <v-btn value="all" size="small">{{ $t('files.kindAll') }}</v-btn>
          <v-btn value="image" size="small">{{ $t('files.kindImage') }}</v-btn>
          <v-btn value="document" size="small">{{ $t('files.kindDocument') }}</v-btn>
          <v-btn value="audio" size="small">{{ $t('files.kindAudio') }}</v-btn>
          <v-btn value="video" size="small">{{ $t('files.kindVideo') }}</v-btn>
        </v-btn-toggle>
        <v-text-field
          v-model="search"
          density="compact"
          hide-details
          clearable
          variant="outlined"
          class="filelib-search"
          :placeholder="$t('files.searchPlaceholder')"
          prepend-inner-icon="mdi-magnify"
        />
        <v-btn
          color="primary"
          size="small"
          :loading="uploading"
          prepend-icon="mdi-upload"
          @click="triggerUpload"
        >
          {{ $t('files.upload') }}
        </v-btn>
        <input
          ref="fileInputRef"
          type="file"
          class="d-none"
          :accept="UPLOAD_ACCEPT"
          @change="onFilePicked"
        >
        <input
          ref="replaceInputRef"
          type="file"
          class="d-none"
          :accept="replaceAccept"
          @change="onReplacePicked"
        >
      </div>

      <p v-if="errorText" class="filelib-error text-error px-1">
        {{ errorText }}
      </p>

      <div class="filelib-body">
        <div class="filelib-grid-pane">
          <div v-if="loading && items.length === 0" class="filelib-empty">
            {{ $t('files.loading') }}
          </div>
          <div v-else-if="items.length === 0" class="filelib-empty">
            {{ $t('files.empty') }}
          </div>
          <div v-else class="filelib-grid">
            <button
              v-for="item in items"
              :key="item.fileId"
              type="button"
              class="filelib-card"
              :class="{ 'filelib-card--active': item.fileId === selectedId }"
              @click="selectItem(item.fileId)"
            >
              <div class="filelib-card__thumb">
                <img
                  v-if="item.kind === 'image'"
                  :src="mediaUrl(item.fileId, item.updatedAt) ?? undefined"
                  alt=""
                  class="filelib-card__img"
                >
                <v-icon v-else size="36" class="filelib-card__icon">
                  {{ kindIcon(item.kind) }}
                </v-icon>
              </div>
              <div class="filelib-card__meta">
                <span class="filelib-card__name text-truncate">{{ item.name }}</span>
                <span class="filelib-card__sub">{{ formatSize(item.size) }}</span>
                <div v-if="item.tags?.length" class="filelib-card__tags">
                  <span
                    v-for="tg in item.tags.slice(0, 3)"
                    :key="tg"
                    class="filelib-card__tag"
                  >{{ tg }}</span>
                </div>
              </div>
            </button>
          </div>
          <div v-if="hasMore" class="filelib-more">
            <v-btn
              variant="text"
              size="small"
              :loading="loadingMore"
              @click="loadMore"
            >
              {{ $t('files.loadMore', { loaded: items.length, total }) }}
            </v-btn>
          </div>
          <p v-else-if="items.length > 0" class="filelib-more text-medium-emphasis">
            {{ $t('files.loaded', { n: items.length, total }) }}
          </p>
        </div>

        <aside class="filelib-detail" :class="{ 'filelib-detail--empty': !selected }">
          <template v-if="selected">
            <div class="filelib-detail__preview">
              <img
                v-if="selected.kind === 'image' && selectedPreviewUrl"
                :src="selectedPreviewUrl"
                alt=""
                class="filelib-detail__img"
              >
              <audio
                v-else-if="selected.kind === 'audio' && selectedPreviewUrl"
                :src="selectedPreviewUrl"
                controls
                class="filelib-detail__audio"
              />
              <video
                v-else-if="selected.kind === 'video' && selectedPreviewUrl"
                :src="selectedPreviewUrl"
                controls
                class="filelib-detail__video"
              />
              <div v-else class="filelib-detail__doc">
                <v-icon size="48">{{ kindIcon(selected.kind) }}</v-icon>
                <span>{{ selected.mime }}</span>
              </div>
            </div>
            <h2 class="filelib-detail__title">{{ selected.name }}</h2>
            <div class="filelib-detail__tags">
              <span
                v-for="tg in selectedTags"
                :key="tg"
                class="filelib-detail__tag"
              >{{ tg }}</span>
              <span
                v-if="!selectedTags.length"
                class="filelib-detail__tags-empty"
              >{{ $t('files.tagsEmpty') }}</span>
            </div>
            <dl class="filelib-detail__dl">
              <div>
                <dt>{{ $t('files.fieldId') }}</dt>
                <dd><code>{{ selected.fileId }}</code></dd>
              </div>
              <div>
                <dt>{{ $t('files.fieldKind') }}</dt>
                <dd>{{ kindLabel(selected.kind) }}</dd>
              </div>
              <div>
                <dt>{{ $t('files.fieldMime') }}</dt>
                <dd>{{ selected.mime }}</dd>
              </div>
              <div>
                <dt>{{ $t('files.fieldSize') }}</dt>
                <dd>{{ formatSize(selected.size) }}</dd>
              </div>
              <div>
                <dt>{{ $t('files.fieldPath') }}</dt>
                <dd>
                  <a
                    v-if="selectedContentPath"
                    class="filelib-detail__url"
                    :href="selectedContentPath"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ selectedContentPath }}</a>
                </dd>
              </div>
            </dl>
            <div class="filelib-detail__actions">
              <v-tooltip location="top" :text="$t('files.copyPath')">
                <template #activator="{ props: tip }">
                  <v-btn
                    v-bind="tip"
                    icon="mdi-content-copy"
                    size="small"
                    variant="tonal"
                    :aria-label="$t('files.copyPath')"
                    @click="copyContentPath"
                  />
                </template>
              </v-tooltip>
              <v-tooltip location="top" :text="$t('files.update')">
                <template #activator="{ props: tip }">
                  <v-btn
                    v-bind="tip"
                    icon="mdi-upload"
                    size="small"
                    variant="tonal"
                    :loading="replacing"
                    :aria-label="$t('files.update')"
                    @click="triggerReplace"
                  />
                </template>
              </v-tooltip>
              <v-tooltip location="top" :text="$t('files.rename')">
                <template #activator="{ props: tip }">
                  <v-btn
                    v-bind="tip"
                    icon="mdi-pencil-outline"
                    size="small"
                    variant="tonal"
                    :aria-label="$t('files.rename')"
                    @click="openRename"
                  />
                </template>
              </v-tooltip>
              <v-tooltip location="top" :text="$t('files.editTags')">
                <template #activator="{ props: tip }">
                  <v-btn
                    v-bind="tip"
                    icon="mdi-tag-outline"
                    size="small"
                    variant="tonal"
                    :aria-label="$t('files.editTags')"
                    @click="openTags"
                  />
                </template>
              </v-tooltip>
              <v-tooltip location="top" :text="$t('files.delete')">
                <template #activator="{ props: tip }">
                  <v-btn
                    v-bind="tip"
                    icon="mdi-delete-outline"
                    size="small"
                    variant="tonal"
                    color="error"
                    :aria-label="$t('files.delete')"
                    @click="openDelete"
                  />
                </template>
              </v-tooltip>
            </div>
          </template>
          <p v-else class="filelib-empty">{{ $t('files.selectHint') }}</p>
        </aside>
      </div>
    </div>

    <v-dialog v-model="renameOpen" max-width="28rem">
      <v-card>
        <v-card-title>{{ $t('files.renameTitle') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renameDraft"
            density="compact"
            hide-details
            variant="outlined"
            autofocus
            @keydown.enter.prevent="submitRename"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="renameOpen = false">{{ $t('files.cancel') }}</v-btn>
          <v-btn color="primary" :loading="renameDoing" @click="submitRename">
            {{ $t('files.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="tagsOpen" max-width="28rem">
      <v-card>
        <v-card-title>{{ $t('files.tagsTitle') }}</v-card-title>
        <v-card-text>
          <p class="text-medium-emphasis text-caption mb-2">
            {{ $t('files.tagsHint') }}
          </p>
          <v-text-field
            v-model="tagsDraft"
            density="compact"
            hide-details
            variant="outlined"
            autofocus
            :placeholder="$t('files.tagsPlaceholder')"
            @keydown.enter.prevent="submitTags"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="tagsOpen = false">{{ $t('files.cancel') }}</v-btn>
          <v-btn color="primary" :loading="tagsDoing" @click="submitTags">
            {{ $t('files.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteOpen" max-width="28rem">
      <v-card>
        <v-card-title>{{ $t('files.deleteTitle') }}</v-card-title>
        <v-card-text>
          {{ $t('files.deleteConfirm', { name: selected?.name ?? '' }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteOpen = false">{{ $t('files.cancel') }}</v-btn>
          <v-btn color="error" :loading="deleteDoing" @click="submitDelete">
            {{ $t('files.delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.filelib--embedded {
  height: 100%;
  min-height: 0;
}
.filelib__inner {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: 0.75rem;
  padding: 1rem 1.25rem 1.25rem;
}
.filelib__inner--embedded {
  padding-top: 0.75rem;
}
.filelib-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.filelib-search {
  flex: 1 1 12rem;
  min-width: 10rem;
  max-width: 20rem;
}
.filelib-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 20rem);
  gap: 0.75rem;
  flex: 1 1 auto;
  min-height: 0;
}
.filelib-grid-pane {
  overflow: auto;
  min-height: 0;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 0.75rem;
  padding: 0.75rem;
}
.filelib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
  gap: 0.65rem;
}
.filelib-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  text-align: left;
  padding: 0.4rem;
  border-radius: 0.65rem;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.filelib-card:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.filelib-card--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
.filelib-card__thumb {
  aspect-ratio: 1;
  border-radius: 0.5rem;
  background: rgba(var(--v-theme-on-surface), 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.filelib-card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.filelib-card__name {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
}
.filelib-card__sub {
  font-size: 0.7rem;
  opacity: 0.7;
}
.filelib-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
  margin-top: 0.15rem;
}
.filelib-card__tag {
  font-size: 0.65rem;
  line-height: 1.2;
  padding: 0.05rem 0.3rem;
  border-radius: 0.25rem;
  background: rgba(var(--v-theme-on-surface), 0.08);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.filelib-more {
  margin-top: 0.75rem;
  text-align: center;
  font-size: 0.8rem;
}
.filelib-detail {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 0.75rem;
  padding: 0.85rem;
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.filelib-detail__preview {
  border-radius: 0.5rem;
  background: rgba(var(--v-theme-on-surface), 0.05);
  min-height: 10rem;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.filelib-detail__img {
  max-width: 100%;
  max-height: 14rem;
  object-fit: contain;
}
.filelib-detail__audio,
.filelib-detail__video {
  width: 100%;
}
.filelib-detail__doc {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  opacity: 0.8;
  font-size: 0.8rem;
  padding: 1rem;
}
.filelib-detail__title {
  font-size: 1rem;
  font-weight: 650;
  margin: 0;
  word-break: break-word;
}
.filelib-detail__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  min-height: 1.25rem;
}
.filelib-detail__tag {
  font-size: 0.72rem;
  line-height: 1.3;
  padding: 0.1rem 0.4rem;
  border-radius: 0.3rem;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.filelib-detail__tags-empty {
  font-size: 0.75rem;
  opacity: 0.55;
}
.filelib-detail__dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.78rem;
}
.filelib-detail__dl dt {
  opacity: 0.65;
  font-size: 0.7rem;
}
.filelib-detail__dl dd {
  margin: 0;
  word-break: break-all;
}
.filelib-detail__url {
  color: rgb(var(--v-theme-primary));
  text-decoration: underline;
  text-underline-offset: 0.15em;
  word-break: break-all;
}
.filelib-detail__url:hover {
  opacity: 0.85;
}
.filelib-detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: auto;
  align-items: center;
  justify-content: space-around;
}
.filelib-empty {
  padding: 1.5rem 0.5rem;
  text-align: center;
  opacity: 0.7;
  font-size: 0.9rem;
}
.filelib-error {
  font-size: 0.85rem;
}

@media (max-width: 860px) {
  .filelib-body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(12rem, 45%) minmax(0, 1fr);
  }
}
</style>
