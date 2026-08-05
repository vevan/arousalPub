<script setup lang="ts">
import { useLorebooksStore } from '@/stores/lorebooks'
import { mergeSelectAllVisible } from '@/utils/entry-batch-transfer'
import {
  lorebookEntryMissingKeywords,
  resolveEntryPosition,
  resolveEntryTriggerMode,
  type LorebookEntryPosition,
  type LorebookTriggerMode,
} from '@/utils/lorebook-entry'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  'batch-transfer': [mode: 'copy' | 'move']
  'create-entry': []
}>()

const { t } = useI18n()
const store = useLorebooksStore()
const {
  activeGroupId,
  searchText,
  visibleEntries,
  selectedEntryId,
  multiSelectMode,
  selectedEntryIds,
} = storeToRefs(store)

const entryDragId = ref<string | null>(null)
const entryDragOverIdx = ref<number | null>(null)

function onEntryDragStart(id: string, evt: DragEvent) {
  if (multiSelectMode.value) {
    evt.preventDefault()
    return
  }
  entryDragId.value = id
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = 'move'
    evt.dataTransfer.setData('text/plain', id)
  }
}

function onEntryCardClick(entryId: string) {
  if (multiSelectMode.value) {
    store.toggleEntryMultiSelected(entryId)
    return
  }
  store.selectEntry(entryId)
}
function onEntryDragOver(idx: number, evt: DragEvent) {
  if (!entryDragId.value) return
  evt.preventDefault()
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move'
  entryDragOverIdx.value = idx
}
function onEntryDrop(idx: number) {
  if (!entryDragId.value) return
  store.reorderEntry(entryDragId.value, idx)
  entryDragId.value = null
  entryDragOverIdx.value = null
}
function onEntryDragEnd() {
  entryDragId.value = null
  entryDragOverIdx.value = null
}

function selectAllVisibleEntries() {
  store.setSelectedEntryIds(
    mergeSelectAllVisible(
      selectedEntryIds.value,
      visibleEntries.value.map((e) => e.id),
    ),
  )
}

function openBatchTransfer(mode: 'copy' | 'move') {
  emit('batch-transfer', mode)
}

function createEntry() {
  emit('create-entry')
}

function previewBody(content: string, max = 120): string {
  const text = content.trim().replace(/\s+/g, ' ')
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function entryMetaLine(e: {
  constant: boolean
  triggerMode?: LorebookTriggerMode
  position?: LorebookEntryPosition
  keys: string[]
}): string {
  const mode = resolveEntryTriggerMode(e)
  const pos =
    resolveEntryPosition(e) === 'before_char'
      ? t('lorebooks.positionBeforeChar')
      : t('lorebooks.positionAfterChar')
  if (mode === 'constant') return `${t('lorebooks.constant')} · ${pos}`
  if (mode === 'vector') return `${t('lorebooks.triggerVector')} · ${pos}`
  if (lorebookEntryMissingKeywords(e)) return t('lorebooks.entryMissingKeys')
  if (e.keys.length) return `${e.keys.join(' · ')} · ${pos}`
  return pos
}
</script>

<template>
        <aside class="prompts-list">
          <div class="prompts-search">
            <div class="prompts-search__field">
              <svg
                class="prompts-search__icon"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3" />
                <path d="M10.5 10.5 L13.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
              </svg>
              <input
                :value="searchText"
                type="text"
                class="prompts-search__input"
                :placeholder="$t('lorebooks.searchPlaceholder')"
                @input="store.setSearchText(($event.target as HTMLInputElement).value)"
              />
              <button
                v-if="searchText"
                type="button"
                class="prompts-search__clear"
                @click="store.setSearchText('')"
              >×</button>
            </div>
            <button
              v-if="!multiSelectMode"
              type="button"
              class="prompts-search__multi"
              @click="store.enterMultiSelect()"
            >{{ $t('entryTransfer.multiSelect') }}</button>
            <button
              v-else
              type="button"
              class="prompts-search__multi is-active"
              @click="store.exitMultiSelect()"
            >{{ $t('entryTransfer.multiSelectDone') }}</button>
          </div>

          <div
            v-if="multiSelectMode"
            class="entry-batch-bar"
          >
            <span class="entry-batch-bar__count">
              {{ $t('entryTransfer.batchSelected', { n: selectedEntryIds.length }) }}
            </span>
            <button
              type="button"
              class="entry-batch-bar__btn"
              @click="selectAllVisibleEntries"
            >{{ $t('entryTransfer.batchSelectAllVisible') }}</button>
            <button
              type="button"
              class="entry-batch-bar__btn"
              :disabled="selectedEntryIds.length === 0"
              @click="store.clearMultiSelection()"
            >{{ $t('entryTransfer.batchClearSelection') }}</button>
            <v-spacer />
            <button
              type="button"
              class="entry-batch-bar__btn entry-batch-bar__btn--primary"
              :disabled="selectedEntryIds.length === 0"
              @click="openBatchTransfer('copy')"
            >{{ $t('entryTransfer.batchCopyTo') }}</button>
            <button
              type="button"
              class="entry-batch-bar__btn entry-batch-bar__btn--primary"
              :disabled="selectedEntryIds.length === 0"
              @click="openBatchTransfer('move')"
            >{{ $t('entryTransfer.batchMoveTo') }}</button>
          </div>

          <div class="prompts-list__scroll">
            <button
              v-if="activeGroupId && !multiSelectMode"
              type="button"
              class="entry-card entry-card--new"
              @click="createEntry"
            >
              <span class="entry-card--new__plus">+</span>
              <span class="entry-card--new__label">{{ $t('lorebooks.entryNew') }}</span>
            </button>

            <template v-for="(e, idx) in visibleEntries" :key="e.id">
              <span
                v-if="entryDragOverIdx === idx"
                class="entry-drop-indicator"
              />
              <article
                class="entry-card"
                :class="{
                  'is-active': !multiSelectMode && selectedEntryId === e.id,
                  'is-selected': multiSelectMode && selectedEntryIds.includes(e.id),
                  'is-disabled': !e.enabled,
                  'is-dragging': entryDragId === e.id,
                }"
                tabindex="0"
                :draggable="!multiSelectMode"
                @click="onEntryCardClick(e.id)"
                @dragstart="onEntryDragStart(e.id, $event)"
                @dragover="onEntryDragOver(idx, $event)"
                @drop="onEntryDrop(idx)"
                @dragend="onEntryDragEnd"
              >
                <div class="entry-card__row">
                  <v-checkbox
                    v-if="multiSelectMode"
                    :model-value="selectedEntryIds.includes(e.id)"
                    density="compact"
                    hide-details
                    class="entry-card__check"
                    @click.stop
                    @update:model-value="store.toggleEntryMultiSelected(e.id)"
                  />
                  <v-icon
                    v-else
                    size="14"
                    class="entry-card__handle"
                    :title="$t('prompts.dragHandle')"
                  >
                    mdi-drag-vertical
                  </v-icon>
                  <button
                    type="button"
                    class="entry-card__enabled"
                    :class="{ 'is-on': e.enabled }"
                    @click.stop="store.updateEntry(e.id, { enabled: !e.enabled })"
                  ></button>
                  <h2 class="entry-card__title">
                    {{ e.title || $t('lorebooks.untitled') }}
                  </h2>
                </div>
                <p
                  v-if="e.content"
                  class="entry-card__body"
                >{{ previewBody(e.content) }}</p>
                <div class="entry-card__meta">
                  <span
                    class="entry-card__pos"
                    :class="{
                      'is-chat': e.constant,
                      'is-warn': lorebookEntryMissingKeywords(e),
                    }"
                  >{{ entryMetaLine(e) }}</span>
                  <span class="entry-card__trigs">{{ $t('lorebooks.order') }} {{ e.order }} · {{ $t('lorebooks.priority') }} {{ e.priority }}</span>
                </div>
              </article>
            </template>
            <span
              v-if="entryDragOverIdx === visibleEntries.length"
              class="entry-drop-indicator"
            />

            <div
              v-if="activeGroupId && visibleEntries.length === 0"
              class="prompts-empty"
            >
              <div class="prompts-empty__title">{{ $t('lorebooks.emptyTitle') }}</div>
              <div class="prompts-empty__hint">{{ $t('lorebooks.emptyHint') }}</div>
            </div>
          </div>
        </aside>
</template>
