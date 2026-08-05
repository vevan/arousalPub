<script setup lang="ts">
import {
  bindingSlotAllowsToggle,
  bindingSlotBundlePartsKey,
  bindingSlotHasEditableContent,
  bindingSlotLabelKey,
  groupIcon,
  previewPromptBody,
  showHistoryTokenTrim,
} from '@/components/prompts/prompt-entry-ui'
import {
  groupAllowsPromptEntries,
  usePromptsStore,
  type PromptEntry,
  type PromptGroup,
} from '@/stores/prompts'
import { mergeSelectAllVisible } from '@/utils/entry-batch-transfer'
import {
  bindingSlotUsesLegacyBundle,
  charCoreListInnerEntry,
  historyListInnerEntry,
  legacyBundleDescKey,
  legacyBundleTitleKey,
  shouldHideCharSystemPromptInList,
  shouldHideHistoryPostHistoryInList,
} from '@/utils/system-binding-slots'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

const emit = defineEmits<{
  'batch-transfer': [mode: 'copy' | 'move']
  'create-entry': []
}>()

const store = usePromptsStore()
const {
  activeGroups,
  activeGroupId,
  searchText,
  selected,
  visiblePrompts,
  activePrompts,
  multiSelectMode,
  selectedPromptIds,
} = storeToRefs(store)

const entryDragId = ref<string | null>(null)
const entryDragOverIdx = ref<number | null>(null)

type PromptListRow =
  | {
      kind: 'legacy-bundle'
      entry: PromptEntry
      innerEntry: PromptEntry
      key: string
    }
  | { kind: 'entry'; entry: PromptEntry; key: string }

const currentGroup = computed<PromptGroup | null>(() => {
  if (!activeGroupId.value) return null
  return activeGroups.value.find((g) => g.id === activeGroupId.value) ?? null
})

const isEntryListGroup = computed(() =>
  currentGroup.value ? groupAllowsPromptEntries(currentGroup.value.kind) : false,
)

function isEntryMutedByGroup(p: PromptEntry): boolean {
  const g = activeGroups.value.find((x) => x.id === p.groupId)
  return g?.enabled === false && !p.bindingSlot
}

const listRenderRows = computed((): PromptListRow[] => {
  const rows: PromptListRow[] = []
  const prompts = visiblePrompts.value
  const groupKind = currentGroup.value?.kind
  const groupId = currentGroup.value?.id
  const groupPrompts = groupId
    ? activePrompts.value.filter((e) => e.groupId === groupId)
    : []
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i]
    if (shouldHideCharSystemPromptInList(p, groupPrompts)) continue
    if (shouldHideHistoryPostHistoryInList(p, groupPrompts)) continue

    if (bindingSlotUsesLegacyBundle(p.bindingSlot, groupKind, groupPrompts)) {
      const inner =
        charCoreListInnerEntry(p, groupPrompts) ??
        historyListInnerEntry(p, groupPrompts) ??
        p
      rows.push({
        kind: 'legacy-bundle',
        entry: p,
        innerEntry: inner,
        key: p.id,
      })
      continue
    }

    rows.push({ kind: 'entry', entry: p, key: p.id })
  }
  return rows
})

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
function onEntryDragOver(idx: number, evt: DragEvent) {
  if (!entryDragId.value) return
  evt.preventDefault()
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move'
  entryDragOverIdx.value = idx
}
function onEntryDrop(idx: number) {
  if (!entryDragId.value) return
  const targetGroupId = activeGroupId.value
  if (!targetGroupId) return
  store.reorderPrompt(entryDragId.value, targetGroupId, idx)
  entryDragId.value = null
  entryDragOverIdx.value = null
}

function rowDropTargetIndex(rowIdx: number): number {
  const row = listRenderRows.value[rowIdx]
  if (!row) return rowIdx
  const anchorId = row.entry.id
  const i = visiblePrompts.value.findIndex((p) => p.id === anchorId)
  return i >= 0 ? i : rowIdx
}

function onEntryDropAtRow(rowIdx: number) {
  onEntryDrop(rowDropTargetIndex(rowIdx))
}
function onEntryDragEnd() {
  entryDragId.value = null
  entryDragOverIdx.value = null
}

function selectEntry(id: string) {
  if (multiSelectMode.value) {
    store.togglePromptMultiSelected(id)
    return
  }
  store.selectPrompt(id)
}

function onInnerSlotEnabledToggle(inner: PromptEntry) {
  store.updatePrompt(inner.id, { enabled: !inner.enabled })
}

function selectAllVisiblePrompts() {
  const visibleIds = visiblePrompts.value
    .filter((e) => !e.bindingSlot)
    .map((e) => e.id)
  store.setSelectedPromptIds(
    mergeSelectAllVisible(selectedPromptIds.value, visibleIds),
  )
}

function openBatchTransfer(mode: 'copy' | 'move') {
  emit('batch-transfer', mode)
}

function createEntry() {
  emit('create-entry')
}

const previewBody = previewPromptBody
</script>

<template>
        <!-- ====== Left list ====== -->
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
                :placeholder="$t('prompts.searchPlaceholder')"
                :aria-label="$t('prompts.searchPlaceholder')"
                @input="store.setSearchText(($event.target as HTMLInputElement).value)"
              />
              <button
                v-if="searchText"
                type="button"
                class="prompts-search__clear"
                :aria-label="$t('prompts.clearSearch')"
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
              {{ $t('entryTransfer.batchSelected', { n: selectedPromptIds.length }) }}
            </span>
            <button
              type="button"
              class="entry-batch-bar__btn"
              @click="selectAllVisiblePrompts"
            >{{ $t('entryTransfer.batchSelectAllVisible') }}</button>
            <button
              type="button"
              class="entry-batch-bar__btn"
              :disabled="selectedPromptIds.length === 0"
              @click="store.clearMultiSelection()"
            >{{ $t('entryTransfer.batchClearSelection') }}</button>
            <v-spacer />
            <button
              type="button"
              class="entry-batch-bar__btn entry-batch-bar__btn--primary"
              :disabled="selectedPromptIds.length === 0"
              @click="openBatchTransfer('copy')"
            >{{ $t('entryTransfer.batchCopyTo') }}</button>
            <button
              type="button"
              class="entry-batch-bar__btn entry-batch-bar__btn--primary"
              :disabled="selectedPromptIds.length === 0"
              @click="openBatchTransfer('move')"
            >{{ $t('entryTransfer.batchMoveTo') }}</button>
          </div>

          <div class="prompts-list__scroll">
            <button
              v-if="isEntryListGroup && !multiSelectMode"
              type="button"
              class="entry-card entry-card--new"
              @click="createEntry"
            >
              <span class="entry-card--new__plus">+</span>
              <span class="entry-card--new__label">{{ $t('prompts.newPrompt') }}</span>
            </button>

            <template v-for="(row, rowIdx) in listRenderRows" :key="row.key">
              <span
                v-if="entryDragOverIdx === rowIdx && isEntryListGroup && !multiSelectMode"
                class="entry-drop-indicator"
              />
              <div
                v-if="row.kind === 'legacy-bundle'"
                class="character-system-bundle"
                :class="{
                  'is-active':
                    !multiSelectMode &&
                    (selected?.id === row.entry.id ||
                      selected?.id === row.innerEntry.id),
                  'is-disabled': isEntryMutedByGroup(row.entry),
                  'is-dragging':
                    entryDragId === row.entry.id ||
                    entryDragId === row.innerEntry.id,
                }"
                tabindex="0"
                :draggable="!multiSelectMode"
                @click="multiSelectMode ? undefined : selectEntry(row.entry.id)"
                @keydown.enter="multiSelectMode ? undefined : selectEntry(row.entry.id)"
                @dragstart="onEntryDragStart(row.entry.id, $event)"
                @dragover="onEntryDragOver(rowIdx, $event)"
                @drop="onEntryDropAtRow(rowIdx)"
                @dragend="onEntryDragEnd"
              >
                <div class="character-system-bundle__chrome">
                  <v-icon
                    size="14"
                    class="character-system-bundle__handle"
                    :title="$t('prompts.dragHandle')"
                  >
                    mdi-drag-vertical
                  </v-icon>
                  <v-icon size="20" class="character-system-bundle__icon">
                    {{ groupIcon(currentGroup!.kind) }}
                  </v-icon>
                  <div class="character-system-bundle__title">
                    {{ $t(legacyBundleTitleKey(row.entry.bindingSlot, currentGroup?.kind)) }}
                  </div>
                  <div class="character-system-bundle__desc group-bound-desc">
                    <p>
                      {{ $t(legacyBundleDescKey(row.entry.bindingSlot, currentGroup?.kind)) }}
                    </p>
                    <p
                      v-if="
                        row.entry.bindingSlot === 'boundChatHistory' &&
                        showHistoryTokenTrim(currentGroup?.kind)
                      "
                    >
                      {{ $t('prompts.groupBoundHistoryTokenTrim') }}
                    </p>
                    <p class="group-bound-desc__drag">
                      {{ $t('prompts.groupBoundDragHint') }}
                    </p>
                  </div>
                </div>
                <article
                  class="entry-card entry-card--in-character-bundle"
                  :class="{
                    'is-active': selected?.id === row.innerEntry.id,
                    'is-disabled': !row.innerEntry.enabled,
                  }"
                  draggable="false"
                  @click.stop="selectEntry(row.innerEntry.id)"
                >
                  <div class="entry-card__row">
                    <button
                      v-if="bindingSlotAllowsToggle(row.innerEntry.bindingSlot)"
                      type="button"
                      class="entry-card__enabled"
                      :class="{ 'is-on': row.innerEntry.enabled }"
                      :aria-pressed="row.innerEntry.enabled"
                      :title="$t('prompts.fieldEnabled')"
                      @click.stop="
                        onInnerSlotEnabledToggle(row.innerEntry)
                      "
                    ></button>
                    <h2 class="entry-card__title entry-card__title--bundle-inner">
                      {{ $t(bindingSlotLabelKey(row.innerEntry.bindingSlot)) }}
                    </h2>
                    <span class="entry-card__binding">{{ $t('prompts.bindingSlotTag') }}</span>
                  </div>
                  <div class="entry-card__meta entry-card__meta--binding">
                    <span
                      v-if="bindingSlotBundlePartsKey(row.innerEntry.bindingSlot)"
                      class="entry-card__bundle-parts"
                    >
                      {{ $t(bindingSlotBundlePartsKey(row.innerEntry.bindingSlot)!) }}
                    </span>
                    <span class="entry-card__pos">{{ $t('prompts.positionRelative') }}</span>
                  </div>
                </article>
              </div>
              <article
                v-else
                class="entry-card"
                :class="{
                  'is-active': !multiSelectMode && selected?.id === row.entry.id,
                  'is-selected':
                    multiSelectMode &&
                    !row.entry.bindingSlot &&
                    selectedPromptIds.includes(row.entry.id),
                  'is-disabled': !row.entry.enabled || isEntryMutedByGroup(row.entry),
                  'is-dragging': entryDragId === row.entry.id,
                }"
                tabindex="0"
                :draggable="!multiSelectMode"
                @click="selectEntry(row.entry.id)"
                @keydown.enter="selectEntry(row.entry.id)"
                @dragstart="onEntryDragStart(row.entry.id, $event)"
                @dragover="onEntryDragOver(rowIdx, $event)"
                @drop="onEntryDropAtRow(rowIdx)"
                @dragend="onEntryDragEnd"
              >
                <div class="entry-card__row">
                  <v-checkbox
                    v-if="multiSelectMode && !row.entry.bindingSlot"
                    :model-value="selectedPromptIds.includes(row.entry.id)"
                    density="compact"
                    hide-details
                    class="entry-card__check"
                    @click.stop
                    @update:model-value="store.togglePromptMultiSelected(row.entry.id)"
                  />
                  <v-icon
                    v-else-if="!multiSelectMode"
                    size="14"
                    class="entry-card__handle"
                    :title="$t('prompts.dragHandle')"
                  >
                    mdi-drag-vertical
                  </v-icon>
                  <button
                    v-if="!row.entry.bindingSlot || bindingSlotAllowsToggle(row.entry.bindingSlot)"
                    type="button"
                    class="entry-card__enabled"
                    :class="{ 'is-on': row.entry.enabled }"
                    :aria-pressed="row.entry.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    @click.stop="store.updatePrompt(row.entry.id, { enabled: !row.entry.enabled })"
                  ></button>
                  <h2 class="entry-card__title">
                    <template v-if="row.entry.bindingSlot">{{
                      $t(bindingSlotLabelKey(row.entry.bindingSlot))
                    }}</template>
                    <template v-else>{{ row.entry.title || $t('prompts.untitled') }}</template>
                  </h2>
                  <span
                    v-if="row.entry.bindingSlot"
                    class="entry-card__binding"
                  >{{ $t('prompts.bindingSlotTag') }}</span>
                  <span
                    v-else-if="row.entry.isSeed"
                    class="entry-card__seed"
                  >{{ $t('prompts.seedTag') }}</span>
                </div>
                <p
                  v-if="
                    (row.entry.description || row.entry.content) &&
                    (!row.entry.bindingSlot ||
                      bindingSlotHasEditableContent(row.entry.bindingSlot))
                  "
                  class="entry-card__body"
                >{{ previewBody(row.entry) }}</p>
                <div
                  v-if="!row.entry.bindingSlot || bindingSlotHasEditableContent(row.entry.bindingSlot)"
                  class="entry-card__meta"
                >
                  <span class="entry-card__role-chip" :class="`role-${row.entry.role}`">
                    {{ $t(`prompts.role${row.entry.role.charAt(0).toUpperCase() + row.entry.role.slice(1)}`) }}
                  </span>
                  <span
                    class="entry-card__pos"
                    :class="{ 'is-chat': row.entry.injectionPosition === 'chat' }"
                  >
                    {{ row.entry.injectionPosition === 'relative'
                      ? $t('prompts.positionRelative')
                      : `${$t('prompts.positionChat')} · ${$t('prompts.fieldDepth')} ${row.entry.injectionDepth}` }}
                  </span>
                  <span
                    v-if="!row.entry.bindingSlot && row.entry.triggers.length"
                    class="entry-card__trigs"
                  >
                    {{ row.entry.triggers.map((t) => $t(`prompts.trigger${t.charAt(0).toUpperCase() + t.slice(1)}`)).join(' · ') }}
                  </span>
                </div>
                <div v-else class="entry-card__meta entry-card__meta--binding">
                  <span class="entry-card__pos">{{ $t('prompts.positionRelative') }}</span>
                </div>
              </article>
            </template>
            <span
              v-if="entryDragOverIdx === listRenderRows.length && isEntryListGroup"
              class="entry-drop-indicator"
            />

            <div
              v-if="isEntryListGroup && listRenderRows.length === 0"
              class="prompts-empty"
            >
              <div class="prompts-empty__title">{{ $t('prompts.emptyTitle') }}</div>
              <div class="prompts-empty__hint">{{ $t('prompts.emptyHint') }}</div>
            </div>
          </div>
        </aside>
</template>
