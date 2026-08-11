<script setup lang="ts">
import { useLorebooksStore } from '@/stores/lorebooks'
import {
  entryKeysInputDisabled,
  formatLorebookKeysInput,
  lorebookEntryMissingKeywords,
  parseLorebookKeysInput,
  patchForTriggerMode,
  resolveEntryPosition,
  resolveEntryTriggerMode,
  type LorebookEntryPosition,
  type LorebookTriggerMode,
} from '@/utils/lorebook-entry'
import { useNarrowLayout } from '@/composables/use-narrow-layout'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ embedded?: boolean }>(),
  { embedded: false },
)

const emit = defineEmits<{
  'batch-transfer': [mode: 'copy' | 'move']
  'delete-entry': []
  'create-entry': []
}>()

const store = useLorebooksStore()
const {
  activeGroupId,
  selectedEntryId,
  activeLorebook,
  activeGroups,
  selectedEntry,
  multiSelectMode,
} = storeToRefs(store)

const { isNarrow } = useNarrowLayout()
const mobileMasterDetail = computed(() => props.embedded && isNarrow.value)
const showEditorPane = computed(
  () =>
    !multiSelectMode.value &&
    (!mobileMasterDetail.value || Boolean(selectedEntryId.value)),
)

const currentGroup = computed(() =>
  activeGroups.value.find((g) => g.id === activeGroupId.value) ?? null,
)

function backToEntryList() {
  selectedEntryId.value = null
}

const titleInputRef = ref<HTMLInputElement | null>(null)

function focusTitle() {
  void nextTick(() => titleInputRef.value?.focus())
}

defineExpose({ focusTitle })

const titleDraft = ref('')
const commentDraft = ref('')
const contentDraft = ref('')
const priorityDraft = ref(0)
const orderDraft = ref(0)
const keysInputDraft = ref('')

function syncEntryEditorDraftsFromEntry(): void {
  const e = selectedEntry.value
  if (!e) {
    titleDraft.value = ''
    commentDraft.value = ''
    contentDraft.value = ''
    priorityDraft.value = 0
    orderDraft.value = 0
    return
  }
  titleDraft.value = e.title
  commentDraft.value = e.comment ?? ''
  contentDraft.value = e.content
  priorityDraft.value = e.priority
  orderDraft.value = e.order
}

function commitEntryEditorDrafts(entryId?: string): void {
  const id = entryId ?? selectedEntry.value?.id
  if (!id) return
  const e = activeLorebook.value.entries.find((x) => x.id === id)
  if (!e) return

  const patch: {
    title?: string
    comment?: string
    content?: string
    priority?: number
    order?: number
  } = {}

  if (titleDraft.value !== e.title) patch.title = titleDraft.value
  if (commentDraft.value !== (e.comment ?? '')) {
    patch.comment = commentDraft.value
  }
  if (contentDraft.value !== e.content) patch.content = contentDraft.value

  const pri = Number(priorityDraft.value)
  const normalizedPri = Number.isFinite(pri) ? pri : 0
  if (normalizedPri !== e.priority) patch.priority = normalizedPri

  const ord = Number(orderDraft.value)
  const normalizedOrd = Number.isFinite(ord) ? ord : 0
  if (normalizedOrd !== e.order) patch.order = normalizedOrd

  if (Object.keys(patch).length > 0) {
    store.updateEntry(id, patch)
  }
}

function syncKeysDraftFromEntry(): void {
  const e = selectedEntry.value
  keysInputDraft.value = e ? formatLorebookKeysInput(e.keys) : ''
}

function commitKeysForEntry(entryId: string, raw: string): void {
  const e = activeLorebook.value.entries.find((x) => x.id === entryId)
  if (!e || entryKeysInputDisabled(e)) return
  const parsed = parseLorebookKeysInput(raw)
  const same =
    parsed.length === e.keys.length &&
    parsed.every((k, i) => k === e.keys[i])
  if (same) return
  store.updateEntry(entryId, { keys: parsed })
}

function commitKeysDraft(): void {
  const e = selectedEntry.value
  if (!e) return
  commitKeysForEntry(e.id, keysInputDraft.value)
}

function commitAllDraftsForEntry(entryId: string): void {
  commitKeysForEntry(entryId, keysInputDraft.value)
  commitEntryEditorDrafts(entryId)
}

watch(selectedEntryId, (id, prevId) => {
  if (prevId != null && prevId !== id) {
    commitAllDraftsForEntry(prevId)
  }
  syncKeysDraftFromEntry()
  syncEntryEditorDraftsFromEntry()
}, { immediate: true })

onBeforeUnmount(() => {
  const id = selectedEntryId.value
  if (id) commitAllDraftsForEntry(id)
})

function onKeysInputKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Enter') return
  e.preventDefault()
  commitKeysDraft()
  ;(e.target as HTMLInputElement)?.blur()
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function setEntryTriggerMode(entryId: string, mode: LorebookTriggerMode) {
  store.updateEntry(entryId, patchForTriggerMode(mode))
}

function setEntryPosition(entryId: string, position: LorebookEntryPosition) {
  store.updateEntry(entryId, { position })
}

function duplicateCurrentEntry() {
  if (!selectedEntry.value) return
  store.duplicateEntry(selectedEntry.value.id)
}

function openEntryTransfer(mode: 'copy' | 'move') {
  emit('batch-transfer', mode)
}

function confirmDeleteEntry() {
  emit('delete-entry')
}

function createEntry() {
  emit('create-entry')
}
</script>

<template>
        <section v-if="showEditorPane" class="prompts-editor">
          <div class="prompts-editor__panel">
          <button
            v-if="mobileMasterDetail"
            type="button"
            class="prompts-editor__back"
            @click="backToEntryList"
          >
            <v-icon size="18">mdi-chevron-left</v-icon>
            {{ $t('lorebooks.backToList') }}
          </button>
          <div class="prompts-editor__scroll">
          <template v-if="selectedEntry">
            <div class="editor-card">
              <header class="editor-card__head">
                <div class="editor-card__head-row">
                  <button
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': selectedEntry.enabled }"
                    @click="store.updateEntry(selectedEntry.id, { enabled: !selectedEntry.enabled })"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <input
                    ref="titleInputRef"
                    v-model="titleDraft"
                    type="text"
                    class="editor-card__title-input"
                    :placeholder="$t('lorebooks.entryTitlePlaceholder')"
                    @blur="commitEntryEditorDrafts()"
                  />
                </div>
                <input
                  v-model="commentDraft"
                  type="text"
                  class="editor-card__description-input"
                  :placeholder="$t('lorebooks.entryCommentPlaceholder')"
                  @blur="commitEntryEditorDrafts()"
                />
                <div class="editor-card__meta">
                  <span>
                    <span class="editor-card__meta-label">{{ $t('lorebooks.fieldGroup') }}</span>
                    {{ currentGroup?.name ?? '—' }}
                  </span>
                  <span>
                    <span class="editor-card__meta-label">{{ $t('lorebooks.fieldUpdatedAt') }}</span>
                    {{ formatDate(selectedEntry.updatedAt) }}
                  </span>
                </div>
              </header>

              <div class="editor-card__field-row editor-card__field-row--trigger-pos">
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">{{ $t('lorebooks.triggerMode') }}</label>
                  <div class="pill-group">
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryTriggerMode(selectedEntry) === 'keyword' }"
                      @click="setEntryTriggerMode(selectedEntry.id, 'keyword')"
                    >{{ $t('lorebooks.triggerKeyword') }}</button>
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryTriggerMode(selectedEntry) === 'constant' }"
                      @click="setEntryTriggerMode(selectedEntry.id, 'constant')"
                    >{{ $t('lorebooks.constant') }}</button>
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryTriggerMode(selectedEntry) === 'vector' }"
                      @click="setEntryTriggerMode(selectedEntry.id, 'vector')"
                    >{{ $t('lorebooks.triggerVector') }}</button>
                  </div>
                  <p
                    v-if="resolveEntryTriggerMode(selectedEntry) === 'vector'"
                    class="text-caption text-medium-emphasis mt-1 mb-0"
                  >
                    {{ $t('lorebooks.triggerVectorHint') }}
                  </p>
                </div>
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">
                    {{ $t('lorebooks.position') }}
                  </label>
                  <div class="pill-group">
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryPosition(selectedEntry) === 'before_char' }"
                      @click="setEntryPosition(selectedEntry.id, 'before_char')"
                    >{{ $t('lorebooks.positionBeforeChar') }}</button>
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryPosition(selectedEntry) === 'after_char' }"
                      @click="setEntryPosition(selectedEntry.id, 'after_char')"
                    >{{ $t('lorebooks.positionAfterChar') }}</button>
                  </div>
                  <p class="text-caption text-medium-emphasis mt-1 mb-0">
                    {{ $t('lorebooks.positionHint') }}
                  </p>
                </div>
              </div>

              <div class="editor-card__field-row editor-card__field-row--nums">
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">
                    {{ $t('lorebooks.order') }}
                    <span class="editor-card__field-hint">{{ $t('lorebooks.orderHint') }}</span>
                  </label>
                  <span class="num-field">
                    <input
                      v-model.number="orderDraft"
                      type="number"
                      class="num-field__input"
                      @blur="commitEntryEditorDrafts()"
                    />
                  </span>
                </div>
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">
                    {{ $t('lorebooks.priority') }}
                    <span class="editor-card__field-hint">{{ $t('lorebooks.priorityHint') }}</span>
                  </label>
                  <span class="num-field">
                    <input
                      v-model.number="priorityDraft"
                      type="number"
                      class="num-field__input"
                      @blur="commitEntryEditorDrafts()"
                    />
                  </span>
                </div>
              </div>

              <v-alert
                v-if="lorebookEntryMissingKeywords(selectedEntry)"
                type="warning"
                density="compact"
                variant="tonal"
                class="editor-card__keys-warn mb-0"
              >
                {{ $t('lorebooks.entryMissingKeysAlert') }}
              </v-alert>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('lorebooks.entryKeys') }}
                  <span class="editor-card__field-hint">{{ $t('lorebooks.entryKeysHint') }}</span>
                </label>
                <input
                  v-model="keysInputDraft"
                  type="text"
                  class="editor-card__tags-input"
                  :class="{ 'editor-card__tags-input--warn': lorebookEntryMissingKeywords(selectedEntry) }"
                  :disabled="entryKeysInputDisabled(selectedEntry)"
                  :placeholder="$t('lorebooks.entryKeysPlaceholder')"
                  @blur="commitKeysDraft"
                  @keydown="onKeysInputKeydown"
                />
              </div>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('lorebooks.entryContent') }}
                </label>
                <textarea
                  v-model="contentDraft"
                  class="editor-card__content-input"
                  rows="18"
                  spellcheck="false"
                  :placeholder="$t('lorebooks.entryContentPlaceholder')"
                  @blur="commitEntryEditorDrafts()"
                />
              </div>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('lorebooks.autosaveHint') }}</span>
                <span class="editor-card__actions">
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="duplicateCurrentEntry"
                  >{{ $t('entryTransfer.copy') }}</button>
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="openEntryTransfer('copy')"
                  >{{ $t('entryTransfer.copyTo') }}</button>
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="openEntryTransfer('move')"
                  >{{ $t('entryTransfer.moveTo') }}</button>
                  <button
                    type="button"
                    class="editor-card__btn editor-card__btn--danger"
                    @click="confirmDeleteEntry"
                  >{{ $t('lorebooks.entryDelete') }}</button>
                </span>
              </footer>
            </div>
          </template>
          <template v-else>
            <div class="editor-empty">
              <v-icon size="44" class="editor-empty__icon">mdi-book-open-page-variant</v-icon>
              <h2 class="editor-empty__title">{{ $t('lorebooks.editorEmptyTitle') }}</h2>
              <p class="editor-empty__hint">{{ $t('lorebooks.editorEmptyHint') }}</p>
              <button
                v-if="activeGroupId"
                type="button"
                class="editor-empty__cta"
                @click="createEntry"
              >+ {{ $t('lorebooks.entryNew') }}</button>
            </div>
          </template>
          </div>
          </div>
        </section>
</template>
