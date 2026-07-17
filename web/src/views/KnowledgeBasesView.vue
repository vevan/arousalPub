<script setup lang="ts">
import { apiFetch } from '@/utils/api-fetch'
import { coreNotify } from '@/utils/core-notify'
import { readJsonSseStream } from '@/utils/json-sse'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
    /** 由资产/知识库壳页提供页头时隐藏自身页头 */
    chromeless?: boolean
  }>(),
  { embedded: false, chromeless: false },
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

type IndexStatus = 'idle' | 'indexing' | 'ready' | 'error'

interface KnowledgeBase {
  id: string
  name: string
  description?: string
  fileIds: string[]
  fileAliases?: Record<string, string>
  createdAt: string
  updatedAt: string
  indexStatus?: IndexStatus
  indexedAt?: string
  chunkCount?: number
  indexError?: string
}

interface DocFileItem {
  fileId: string
  name: string
}

const items = ref<KnowledgeBase[]>([])
const loading = ref(false)
const errorText = ref('')
const selectedId = ref<string | null>(null)
const docNameById = ref<Record<string, string>>({})

const createOpen = ref(false)
const createName = ref('')
const createDescription = ref('')
const createDoing = ref(false)

const addFilesOpen = ref(false)
const addFilesDraft = ref<string[]>([])
const addFilesDoing = ref(false)
const docItems = ref<DocFileItem[]>([])
const docItemsLoading = ref(false)

const aliasOpen = ref(false)
const aliasFileId = ref('')
const aliasDraft = ref('')
const aliasDoing = ref(false)

const deleteOpen = ref(false)
const deleteDoing = ref(false)
const reindexDoing = ref(false)
const reindexError = ref('')
const reindexDone = ref(0)
const reindexTotal = ref(0)
const reindexFiles = ref(0)
const reindexChunks = ref(0)
const reindexStage = ref<
  'planning' | 'extracting' | 'embedding' | 'writing' | 'finalizing'
>('planning')
const patchDoing = ref(false)

type KnowledgeReindexSseEvent =
  | { type: 'start'; files: number; total: number }
  | {
      type: 'progress'
      done: number
      total: number
      stage?: typeof reindexStage.value
      files?: number
      chunks?: number
    }
  | { type: 'done'; ok: true; chunkCount: number }
  | { type: 'error'; ok: false; error: string; detail?: string }

const reindexPercent = computed(() => {
  if (reindexTotal.value < 1) return reindexDoing.value ? 0 : 100
  return Math.min(
    100,
    Math.round((reindexDone.value / reindexTotal.value) * 100),
  )
})

const reindexStageLabel = computed(() =>
  t(`knowledgeBases.reindexStage.${reindexStage.value}`),
)

const selected = computed(
  () => items.value.find((i) => i.id === selectedId.value) ?? null,
)

const addableDocItems = computed(() => {
  const inKb = new Set(selected.value?.fileIds ?? [])
  return docItems.value.filter((d) => !inKb.has(d.fileId))
})

function fileLabel(fileId: string): string {
  return docNameById.value[fileId] || fileId
}

function stripExtension(name: string): string {
  const stripped = name.replace(/\.[^./\\]+$/, '').trim()
  return stripped || name
}

/** 展示名：别名优先，否则文件名去扩展名 */
function fileDisplayLabel(fileId: string): string {
  const alias = selected.value?.fileAliases?.[fileId]?.trim()
  if (alias) return alias
  const raw = docNameById.value[fileId]
  return raw ? stripExtension(raw) : fileId
}

function fileHasAlias(fileId: string): boolean {
  return Boolean(selected.value?.fileAliases?.[fileId]?.trim())
}

function indexStatusLabel(status: IndexStatus | undefined): string {
  switch (status) {
    case 'indexing':
      return t('knowledgeBases.statusIndexing')
    case 'ready':
      return t('knowledgeBases.statusReady')
    case 'error':
      return t('knowledgeBases.statusError')
    case 'idle':
    default:
      return t('knowledgeBases.statusIdle')
  }
}

async function loadList() {
  loading.value = true
  errorText.value = ''
  try {
    const res = await apiFetch('/api/knowledge-bases')
    if (!res.ok) {
      errorText.value = t('knowledgeBases.loadFailed')
      return
    }
    const data = (await res.json()) as { knowledgeBases?: KnowledgeBase[] }
    items.value = Array.isArray(data.knowledgeBases) ? data.knowledgeBases : []
    if (
      selectedId.value &&
      !items.value.some((i) => i.id === selectedId.value)
    ) {
      selectedId.value = items.value[0]?.id ?? null
    }
    if (!selectedId.value && items.value[0]) {
      selectedId.value = items.value[0].id
    }
  } catch {
    errorText.value = t('knowledgeBases.loadFailed')
  } finally {
    loading.value = false
  }
}

async function loadDocumentNames() {
  try {
    const res = await apiFetch('/api/files?kind=document&offset=0&limit=200')
    if (!res.ok) return
    const data = (await res.json()) as {
      items?: { fileId?: string; name?: string }[]
    }
    const map: Record<string, string> = {}
    const list: DocFileItem[] = []
    for (const raw of data.items ?? []) {
      if (typeof raw.fileId !== 'string' || !raw.fileId.trim()) continue
      const name =
        typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim()
          : raw.fileId
      map[raw.fileId] = name
      list.push({ fileId: raw.fileId, name })
    }
    docNameById.value = map
    docItems.value = list
  } catch {
    /* ignore */
  }
}

function selectItem(id: string) {
  selectedId.value = id
}

function openCreate() {
  createName.value = ''
  createDescription.value = ''
  createOpen.value = true
}

async function submitCreate() {
  const name = createName.value.trim()
  if (!name) return
  createDoing.value = true
  try {
    const body: { name: string; description?: string } = { name }
    const desc = createDescription.value.trim()
    if (desc) body.description = desc
    const res = await apiFetch('/api/knowledge-bases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string }
      coreNotify(
        t('knowledgeBases.createFailed'),
        errBody.error ? t(`api.errors.${errBody.error}`, errBody.error) : undefined,
        { level: 'error' },
      )
      return
    }
    const kb = (await res.json()) as KnowledgeBase
    createOpen.value = false
    await loadList()
    selectedId.value = kb.id
    coreNotify(t('knowledgeBases.createOk'), undefined, { level: 'success' })
  } catch {
    coreNotify(t('knowledgeBases.createFailed'), undefined, { level: 'error' })
  } finally {
    createDoing.value = false
  }
}

async function openAddFiles() {
  if (!selected.value) return
  addFilesDraft.value = []
  addFilesOpen.value = true
  docItemsLoading.value = true
  try {
    await loadDocumentNames()
  } finally {
    docItemsLoading.value = false
  }
}

async function submitAddFiles() {
  if (!selected.value || addFilesDraft.value.length === 0) return
  addFilesDoing.value = true
  try {
    const nextIds = [
      ...selected.value.fileIds,
      ...addFilesDraft.value.filter((id) => !selected.value!.fileIds.includes(id)),
    ]
    const ok = await patchKb(selected.value.id, { fileIds: nextIds })
    if (ok) {
      addFilesOpen.value = false
      coreNotify(t('knowledgeBases.addFilesOk'), undefined, { level: 'success' })
    }
  } finally {
    addFilesDoing.value = false
  }
}

async function removeFile(fileId: string) {
  if (!selected.value) return
  patchDoing.value = true
  try {
    const nextIds = selected.value.fileIds.filter((id) => id !== fileId)
    const ok = await patchKb(selected.value.id, { fileIds: nextIds })
    if (ok) {
      coreNotify(t('knowledgeBases.removeFileOk'), undefined, {
        level: 'success',
      })
    }
  } finally {
    patchDoing.value = false
  }
}

async function patchKb(
  id: string,
  body: { fileIds?: string[]; fileAliases?: Record<string, string> },
): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/knowledge-bases/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string }
      coreNotify(
        t('knowledgeBases.patchFailed'),
        errBody.error ? t(`api.errors.${errBody.error}`, errBody.error) : undefined,
        { level: 'error' },
      )
      return false
    }
    const kb = (await res.json()) as KnowledgeBase
    const idx = items.value.findIndex((i) => i.id === id)
    if (idx >= 0) items.value[idx] = kb
    else await loadList()
    return true
  } catch {
    coreNotify(t('knowledgeBases.patchFailed'), undefined, { level: 'error' })
    return false
  }
}

function openAliasEdit(fileId: string) {
  aliasFileId.value = fileId
  aliasDraft.value = selected.value?.fileAliases?.[fileId] ?? ''
  aliasOpen.value = true
}

async function submitAlias() {
  if (!selected.value || !aliasFileId.value) return
  aliasDoing.value = true
  try {
    const ok = await patchKb(selected.value.id, {
      fileAliases: { [aliasFileId.value]: aliasDraft.value.trim() },
    })
    if (ok) {
      aliasOpen.value = false
      coreNotify(t('knowledgeBases.aliasOk'), undefined, { level: 'success' })
    }
  } finally {
    aliasDoing.value = false
  }
}

async function submitReindex() {
  if (!selected.value) return
  const id = selected.value.id
  reindexDoing.value = true
  reindexError.value = ''
  reindexDone.value = 0
  reindexTotal.value = 0
  reindexFiles.value = selected.value.fileIds.length
  reindexChunks.value = 0
  reindexStage.value = 'planning'
  let finished = false
  try {
    const res = await apiFetch(
      `/api/knowledge-bases/${id}/reindex?stream=1`,
      { method: 'POST' },
    )
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string
        detail?: string
      }
      reindexError.value =
        errBody.detail ||
        (errBody.error
          ? t(`api.errors.${errBody.error}`, errBody.error)
          : t('knowledgeBases.reindexFailed'))
      coreNotify(t('knowledgeBases.reindexFailed'), reindexError.value, {
        level: 'error',
      })
      return
    }

    await readJsonSseStream<KnowledgeReindexSseEvent>(res.body, (ev) => {
      if (ev.type === 'start') {
        reindexFiles.value = ev.files
        reindexTotal.value = ev.total
        reindexDone.value = 0
        reindexStage.value = 'planning'
        return
      }
      if (ev.type === 'progress') {
        reindexDone.value = ev.done
        reindexTotal.value = ev.total
        if (ev.stage) reindexStage.value = ev.stage
        if (typeof ev.files === 'number') reindexFiles.value = ev.files
        if (typeof ev.chunks === 'number') reindexChunks.value = ev.chunks
        return
      }
      if (ev.type === 'error') {
        reindexError.value = ev.error || t('knowledgeBases.reindexFailed')
        if (ev.detail) reindexError.value += `: ${ev.detail}`
        return
      }
      if (ev.type === 'done') {
        finished = true
        reindexDone.value = reindexTotal.value
        reindexChunks.value = ev.chunkCount
        reindexStage.value = 'finalizing'
      }
    })

    if (!finished && !reindexError.value) {
      reindexError.value = t('knowledgeBases.reindexFailed')
    }
    await loadList()
    if (finished) {
      coreNotify(t('knowledgeBases.reindexOk'), undefined, { level: 'success' })
    } else if (reindexError.value) {
      coreNotify(t('knowledgeBases.reindexFailed'), reindexError.value, {
        level: 'error',
      })
    }
  } catch (e) {
    reindexError.value =
      e instanceof Error ? e.message : t('knowledgeBases.reindexFailed')
    coreNotify(t('knowledgeBases.reindexFailed'), reindexError.value, {
      level: 'error',
    })
  } finally {
    reindexDoing.value = false
  }
}

function openDelete() {
  if (!selected.value) return
  deleteOpen.value = true
}

async function submitDelete() {
  if (!selected.value) return
  deleteDoing.value = true
  const id = selected.value.id
  try {
    const res = await apiFetch(`/api/knowledge-bases/${id}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string }
      coreNotify(
        t('knowledgeBases.deleteFailed'),
        errBody.error ? t(`api.errors.${errBody.error}`, errBody.error) : undefined,
        { level: 'error' },
      )
      return
    }
    deleteOpen.value = false
    selectedId.value = null
    await loadList()
    coreNotify(t('knowledgeBases.deleteOk'), undefined, { level: 'success' })
  } catch {
    coreNotify(t('knowledgeBases.deleteFailed'), undefined, { level: 'error' })
  } finally {
    deleteDoing.value = false
  }
}

watch(
  createName,
  (v) => {
    if (v == null) createName.value = ''
  },
  { flush: 'sync' },
)

watch(
  createDescription,
  (v) => {
    if (v == null) createDescription.value = ''
  },
  { flush: 'sync' },
)

watch(
  aliasDraft,
  (v) => {
    if (v == null) aliasDraft.value = ''
  },
  { flush: 'sync' },
)

onMounted(() => {
  void loadList()
  void loadDocumentNames()
})
</script>

<template>
  <div
    class="kblib flex-grow-1 d-flex flex-column min-height-0"
    :class="{ 'kblib--embedded': props.embedded }"
  >
    <div
      class="kblib__inner"
      :class="[
        props.embedded ? 'kblib__inner--embedded' : 'app-page-shell',
        { 'kblib__inner--chromeless': props.chromeless },
      ]"
    >
      <header
        v-if="!props.chromeless"
        class="library-page-head"
        :class="{ 'library-page-head--with-close': props.embedded }"
      >
        <div class="library-page-head__row">
          <h1 class="library-page-head__title">
            {{ $t('knowledgeBases.pageTitle') }}
          </h1>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ $t('knowledgeBases.lede') }}
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

      <div class="kblib-toolbar">
        <v-btn
          color="primary"
          size="small"
          prepend-icon="mdi-plus"
          @click="openCreate"
        >
          {{ $t('knowledgeBases.create') }}
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-refresh"
          :loading="loading"
          @click="loadList"
        >
          {{ $t('knowledgeBases.refresh') }}
        </v-btn>
      </div>

      <p v-if="errorText" class="kblib-error text-error px-1">
        {{ errorText }}
      </p>

      <div class="kblib-body">
        <div class="kblib-list-pane">
          <div v-if="loading && items.length === 0" class="kblib-empty">
            {{ $t('knowledgeBases.loading') }}
          </div>
          <div v-else-if="items.length === 0" class="kblib-empty">
            {{ $t('knowledgeBases.empty') }}
          </div>
          <div v-else class="kblib-list">
            <button
              v-for="item in items"
              :key="item.id"
              type="button"
              class="kblib-list__item"
              :class="{ 'kblib-list__item--active': item.id === selectedId }"
              @click="selectItem(item.id)"
            >
              <span class="kblib-list__name text-truncate">{{ item.name }}</span>
              <span class="kblib-list__meta">
                {{
                  $t('knowledgeBases.listMeta', {
                    files: item.fileIds?.length ?? 0,
                    chunks: item.chunkCount ?? 0,
                  })
                }}
              </span>
            </button>
          </div>
        </div>

        <aside
          class="kblib-detail"
          :class="{ 'kblib-detail--empty': !selected }"
        >
          <template v-if="selected">
            <h2 class="kblib-detail__title">{{ selected.name }}</h2>
            <p
              v-if="selected.description"
              class="kblib-detail__desc text-medium-emphasis"
            >
              {{ selected.description }}
            </p>
            <dl class="kblib-detail__dl">
              <div>
                <dt>{{ $t('knowledgeBases.fieldId') }}</dt>
                <dd><code>{{ selected.id }}</code></dd>
              </div>
              <div>
                <dt>{{ $t('knowledgeBases.fieldStatus') }}</dt>
                <dd>{{ indexStatusLabel(selected.indexStatus) }}</dd>
              </div>
              <div>
                <dt>{{ $t('knowledgeBases.fieldChunkCount') }}</dt>
                <dd>{{ selected.chunkCount ?? 0 }}</dd>
              </div>
              <div v-if="selected.indexError">
                <dt>{{ $t('knowledgeBases.fieldIndexError') }}</dt>
                <dd class="text-error">{{ selected.indexError }}</dd>
              </div>
            </dl>

            <div class="kblib-detail__files">
              <div class="kblib-detail__files-head">
                <h3 class="kblib-detail__files-title">
                  {{ $t('knowledgeBases.filesTitle') }}
                </h3>
                <v-btn
                  size="x-small"
                  variant="tonal"
                  prepend-icon="mdi-file-plus-outline"
                  :disabled="patchDoing"
                  @click="openAddFiles"
                >
                  {{ $t('knowledgeBases.addFiles') }}
                </v-btn>
              </div>
              <p
                v-if="!selected.fileIds.length"
                class="text-caption text-medium-emphasis mb-0"
              >
                {{ $t('knowledgeBases.filesEmpty') }}
              </p>
              <ul v-else class="kblib-file-list">
                <li
                  v-for="fid in selected.fileIds"
                  :key="fid"
                  class="kblib-file-list__row"
                >
                  <span class="kblib-file-list__names">
                    <span class="kblib-file-list__name text-truncate">
                      {{ fileDisplayLabel(fid) }}
                    </span>
                    <span
                      v-if="fileHasAlias(fid)"
                      class="kblib-file-list__raw text-truncate"
                    >
                      {{ fileLabel(fid) }}
                    </span>
                  </span>
                  <v-btn
                    icon="mdi-pencil-outline"
                    size="x-small"
                    variant="text"
                    :aria-label="$t('knowledgeBases.aliasEdit')"
                    :disabled="patchDoing"
                    @click="openAliasEdit(fid)"
                  />
                  <v-btn
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    :aria-label="$t('knowledgeBases.removeFile')"
                    :disabled="patchDoing"
                    @click="removeFile(fid)"
                  />
                </li>
              </ul>
            </div>

            <div class="kblib-detail__actions">
              <v-btn
                size="small"
                variant="tonal"
                prepend-icon="mdi-database-refresh-outline"
                :loading="reindexDoing"
                :disabled="reindexDoing"
                @click="submitReindex"
              >
                {{ $t('knowledgeBases.reindex') }}
              </v-btn>
              <v-btn
                size="small"
                variant="tonal"
                color="error"
                prepend-icon="mdi-delete-outline"
                :disabled="reindexDoing"
                @click="openDelete"
              >
                {{ $t('knowledgeBases.delete') }}
              </v-btn>
            </div>
            <div
              v-if="reindexDoing || reindexError"
              class="kblib-reindex-progress"
            >
              <p v-if="reindexError" class="text-caption text-error mb-1">
                {{ reindexError }}
              </p>
              <template v-if="reindexDoing">
                <p class="text-caption text-medium-emphasis mb-1">
                  {{ reindexStageLabel }} ·
                  {{
                    $t('knowledgeBases.reindexProgress', {
                      done: reindexDone,
                      total: reindexTotal,
                    })
                  }}
                </p>
                <p
                  v-if="reindexTotal > 0"
                  class="text-caption text-medium-emphasis mb-2"
                >
                  {{
                    $t('knowledgeBases.reindexProgressDetail', {
                      files: reindexFiles,
                      chunks: reindexChunks,
                    })
                  }}
                </p>
                <v-progress-linear
                  :model-value="reindexTotal > 0 ? reindexPercent : undefined"
                  :indeterminate="reindexTotal < 1"
                  height="4"
                  rounded
                  color="primary"
                />
              </template>
            </div>
          </template>
          <p v-else class="kblib-empty">{{ $t('knowledgeBases.selectHint') }}</p>
        </aside>
      </div>
    </div>

    <v-dialog v-model="createOpen" max-width="28rem">
      <v-card>
        <v-card-title>{{ $t('knowledgeBases.createTitle') }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-3">
          <v-text-field
            v-model="createName"
            :label="$t('knowledgeBases.fieldName')"
            density="compact"
            variant="outlined"
            hide-details="auto"
            autofocus
            @keydown.enter.prevent="submitCreate"
          />
          <v-textarea
            v-model="createDescription"
            :label="$t('knowledgeBases.fieldDescription')"
            density="compact"
            variant="outlined"
            hide-details="auto"
            rows="2"
            auto-grow
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="createOpen = false">
            {{ $t('knowledgeBases.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            :loading="createDoing"
            :disabled="!createName.trim()"
            @click="submitCreate"
          >
            {{ $t('knowledgeBases.create') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="addFilesOpen" max-width="32rem">
      <v-card>
        <v-card-title>{{ $t('knowledgeBases.addFilesTitle') }}</v-card-title>
        <v-card-text>
          <p class="text-caption text-medium-emphasis mb-2">
            {{ $t('knowledgeBases.addFilesHint') }}
          </p>
          <v-select
            v-model="addFilesDraft"
            :items="addableDocItems"
            item-title="name"
            item-value="fileId"
            :label="$t('knowledgeBases.addFilesSelect')"
            density="compact"
            variant="outlined"
            multiple
            chips
            closable-chips
            hide-details="auto"
            :loading="docItemsLoading"
            :disabled="docItemsLoading"
          />
          <p
            v-if="!docItemsLoading && addableDocItems.length === 0"
            class="text-caption text-medium-emphasis mt-2 mb-0"
          >
            {{ $t('knowledgeBases.noDocuments') }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="addFilesOpen = false">
            {{ $t('knowledgeBases.cancel') }}
          </v-btn>
          <v-btn
            color="primary"
            :loading="addFilesDoing"
            :disabled="addFilesDraft.length === 0"
            @click="submitAddFiles"
          >
            {{ $t('knowledgeBases.addFiles') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="aliasOpen" max-width="28rem">
      <v-card>
        <v-card-title>{{ $t('knowledgeBases.aliasTitle') }}</v-card-title>
        <v-card-text>
          <p class="text-caption text-medium-emphasis mb-2">
            {{ $t('knowledgeBases.aliasHint') }}
          </p>
          <p class="text-caption mb-3">
            <code>{{ fileLabel(aliasFileId) }}</code>
          </p>
          <v-text-field
            v-model="aliasDraft"
            :label="$t('knowledgeBases.aliasLabel')"
            :placeholder="
              aliasFileId ? stripExtension(fileLabel(aliasFileId)) : ''
            "
            density="compact"
            variant="outlined"
            hide-details="auto"
            autofocus
            clearable
            @keydown.enter.prevent="submitAlias"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="aliasDoing"
            @click="aliasOpen = false"
          >
            {{ $t('knowledgeBases.cancel') }}
          </v-btn>
          <v-btn color="primary" :loading="aliasDoing" @click="submitAlias">
            {{ $t('knowledgeBases.aliasSave') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteOpen" max-width="28rem">
      <v-card>
        <v-card-title>{{ $t('knowledgeBases.deleteTitle') }}</v-card-title>
        <v-card-text>
          {{
            $t('knowledgeBases.deleteConfirm', {
              name: selected?.name ?? '',
            })
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="deleteDoing"
            @click="deleteOpen = false"
          >
            {{ $t('knowledgeBases.cancel') }}
          </v-btn>
          <v-btn color="error" :loading="deleteDoing" @click="submitDelete">
            {{ $t('knowledgeBases.delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.kblib--embedded {
  height: 100%;
  min-height: 0;
}
.kblib__inner {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: 0.75rem;
  padding: 1rem 1.25rem 1.25rem;
}
.kblib__inner--embedded {
  padding-top: 0.75rem;
}
.kblib__inner--chromeless {
  padding-top: 0;
}
.kblib-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.kblib-error {
  margin: 0;
  font-size: 0.875rem;
}
.kblib-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(14rem, 22rem);
  gap: 0.75rem;
  flex: 1 1 auto;
  min-height: 0;
}
.kblib-list-pane {
  overflow: auto;
  min-height: 0;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 0.75rem;
  padding: 0.5rem;
}
.kblib-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.kblib-list__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  width: 100%;
  text-align: left;
  padding: 0.55rem 0.75rem;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.kblib-list__item:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.kblib-list__item--active {
  background: rgba(var(--v-theme-primary), 0.12);
}
.kblib-list__name {
  font-weight: 500;
  max-width: 100%;
}
.kblib-list__meta {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.kblib-detail {
  overflow: auto;
  min-height: 0;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 0.75rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.kblib-detail--empty {
  justify-content: center;
  align-items: center;
}
.kblib-detail__title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  line-height: 1.3;
}
.kblib-detail__desc {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.4;
}
.kblib-detail__dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.8125rem;
}
.kblib-detail__dl > div {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: 0.5rem;
}
.kblib-detail__dl dt {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.kblib-detail__dl dd {
  margin: 0;
  word-break: break-word;
}
.kblib-detail__files-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.kblib-detail__files-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
}
.kblib-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.kblib-file-list__row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  padding: 0.15rem 0;
}
.kblib-file-list__names {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
}
.kblib-file-list__name {
  min-width: 0;
  font-size: 0.8125rem;
}
.kblib-file-list__raw {
  min-width: 0;
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.kblib-detail__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.5rem;
}
.kblib-reindex-progress {
  margin-top: 0.75rem;
}
.kblib-empty {
  margin: 0;
  padding: 1.5rem 0.75rem;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.875rem;
}

@media (max-width: 720px) {
  .kblib-body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(10rem, 40%) minmax(0, 1fr);
  }
}
</style>
