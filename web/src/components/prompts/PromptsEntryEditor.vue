<script setup lang="ts">
import {
  bindingSlotAllowsToggle,
  bindingSlotEditorDescKey,
  bindingSlotHasEditableContent,
  bindingSlotIsRequired,
  bindingSlotLabelKey,
  bindingSlotListHintKey,
  formatPromptDate,
  groupBoundDescKey,
  groupBoundTitleKey,
  groupIcon,
  showHistoryTokenTrim,
} from '@/components/prompts/prompt-entry-ui'
import { useNarrowLayout } from '@/composables/use-narrow-layout'
import {
  groupAllowsPromptEntries,
  usePromptsStore,
  type GroupKind,
  type PromptEntry,
  type PromptGroup,
  type PromptRole,
  type PromptTrigger,
} from '@/stores/prompts'
import {
  bindingSlotUsesFlatSubBlockUi,
  findCharCoreBundlePartner,
  findHistoryBundlePartner,
  isCharCoreListAnchor,
  isCharCoreListBundle,
  isHistoryListAnchor,
  isHistoryListBundle,
  legacyBundleDescKey,
  legacyBundleTitleKey,
} from '@/utils/system-binding-slots'
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

const store = usePromptsStore()
const {
  activeGroups,
  activeGroupId,
  selected,
  selectedPromptId,
  activePrompts,
  multiSelectMode,
} = storeToRefs(store)

const { isNarrow } = useNarrowLayout()
const mobileMasterDetail = computed(() => props.embedded && isNarrow.value)
const showEditorPane = computed(
  () =>
    !multiSelectMode.value &&
    (!mobileMasterDetail.value || Boolean(selectedPromptId.value)),
)

const currentGroup = computed<PromptGroup | null>(() => {
  if (!activeGroupId.value) return null
  return activeGroups.value.find((g) => g.id === activeGroupId.value) ?? null
})

const isEntryListGroup = computed(() =>
  currentGroup.value ? groupAllowsPromptEntries(currentGroup.value.kind) : false,
)

function backToPromptList() {
  store.selectPrompt(null)
}

const titleInputRef = ref<HTMLInputElement | null>(null)

function focusTitle() {
  void nextTick(() => titleInputRef.value?.focus())
}

defineExpose({ focusTitle })

const ROLE_OPTIONS: { id: PromptRole; key: string }[] = [
  { id: 'system', key: 'prompts.roleSystem' },
  { id: 'user', key: 'prompts.roleUser' },
  { id: 'assistant', key: 'prompts.roleAssistant' },
]

const TRIGGER_OPTIONS: { id: PromptTrigger; key: string }[] = [
  { id: 'normal', key: 'prompts.triggerNormal' },
  { id: 'continue', key: 'prompts.triggerContinue' },
  { id: 'swipe', key: 'prompts.triggerSwipe' },
  { id: 'regenerate', key: 'prompts.triggerRegenerate' },
]

const tagsInputDraft = ref('')
const titleDraft = ref('')
const descriptionDraft = ref('')
const contentDraft = ref('')
const depthDraft = ref(0)
const orderDraft = ref(100)

function syncTagsDraftFromEntry(): void {
  const e = selected.value
  tagsInputDraft.value = e ? e.tags.join(', ') : ''
}

function commitTagsDraft(entryId?: string): void {
  const id = entryId ?? selected.value?.id
  if (!id) return
  const e = activePrompts.value.find((x) => x.id === id)
  if (!e) return
  const tags = tagsInputDraft.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const same =
    tags.length === e.tags.length && tags.every((t, i) => t === e.tags[i])
  if (!same) store.updatePrompt(id, { tags })
}

function syncPromptEditorDraftsFromEntry(): void {
  const e = selected.value
  if (!e) {
    titleDraft.value = ''
    descriptionDraft.value = ''
    contentDraft.value = ''
    depthDraft.value = 0
    orderDraft.value = 100
    return
  }
  titleDraft.value = e.title
  descriptionDraft.value = e.description
  contentDraft.value = e.content
  depthDraft.value = e.injectionDepth
  orderDraft.value = e.injectionOrder
}

function commitPromptEditorDrafts(entryId?: string): void {
  const id = entryId ?? selected.value?.id
  if (!id) return
  const e = activePrompts.value.find((x) => x.id === id)
  if (!e) return

  const patch: {
    title?: string
    description?: string
    content?: string
    injectionDepth?: number
    injectionOrder?: number
  } = {}

  if (titleDraft.value !== e.title) patch.title = titleDraft.value
  if (descriptionDraft.value !== e.description) {
    patch.description = descriptionDraft.value
  }
  if (contentDraft.value !== e.content) patch.content = contentDraft.value

  const depth = Number(depthDraft.value)
  const normalizedDepth = Number.isFinite(depth) ? Math.max(0, depth) : 0
  if (normalizedDepth !== e.injectionDepth) {
    patch.injectionDepth = normalizedDepth
  }

  const ord = Number(orderDraft.value)
  const normalizedOrd = Number.isFinite(ord) ? ord : 100
  if (normalizedOrd !== e.injectionOrder) {
    patch.injectionOrder = normalizedOrd
  }

  if (Object.keys(patch).length > 0) store.updatePrompt(id, patch)
}

function commitAllDraftsForEntry(entryId: string): void {
  commitTagsDraft(entryId)
  commitPromptEditorDrafts(entryId)
}

watch(selectedPromptId, (id, prevId) => {
  if (prevId != null && prevId !== id) {
    commitAllDraftsForEntry(prevId)
  }
  syncTagsDraftFromEntry()
  syncPromptEditorDraftsFromEntry()
}, { immediate: true })

onBeforeUnmount(() => {
  const id = selectedPromptId.value
  if (id) commitAllDraftsForEntry(id)
})

function onEnabledToggle() {
  if (!selected.value) return
  if (bindingSlotIsRequired(selected.value.bindingSlot)) return
  store.updatePrompt(selected.value.id, { enabled: !selected.value.enabled })
}

function commitPromptEditorDraftsFromBlur(): void {
  commitPromptEditorDrafts()
}
function setRole(r: PromptRole) {
  if (!selected.value) return
  store.updatePrompt(selected.value.id, { role: r })
}
function setPosition(p: 'relative' | 'chat') {
  if (!selected.value) return
  store.updatePrompt(selected.value.id, { injectionPosition: p })
}
function toggleTrigger(tr: PromptTrigger) {
  if (!selected.value) return
  const cur = selected.value.triggers
  const next = cur.includes(tr) ? cur.filter((x) => x !== tr) : [...cur, tr]
  store.updatePrompt(selected.value.id, { triggers: next })
}

function promptsInGroup(groupId: string | undefined): PromptEntry[] {
  if (!groupId) return []
  return activePrompts.value.filter((e) => e.groupId === groupId)
}

const listBundleEditor = computed((): {
  block: PromptEntry
  slot: PromptEntry
} | null => {
  const s = selected.value
  if (!s?.bindingSlot) return null
  const inGroup = promptsInGroup(s.groupId)
  if (
    isCharCoreListAnchor(s) &&
    isCharCoreListBundle(s, inGroup)
  ) {
    const slot = findCharCoreBundlePartner(s, activePrompts.value)
    if (slot) return { block: s, slot }
  }
  if (s.bindingSlot === 'boundCharSystemPrompt') {
    const block = findCharCoreBundlePartner(s, activePrompts.value)
    if (block) return { block, slot: s }
  }
  if (
    isHistoryListAnchor(s) &&
    isHistoryListBundle(s, inGroup)
  ) {
    const slot = findHistoryBundlePartner(s, activePrompts.value)
    if (slot) return { block: s, slot }
  }
  if (s.bindingSlot === 'boundCharacterPostHistory') {
    const block = findHistoryBundlePartner(s, activePrompts.value)
    if (block) return { block, slot: s }
  }
  return null
})

function entryGroupName(p: PromptEntry) {
  return activeGroups.value.find((g) => g.id === p.groupId)?.name ?? '—'
}

function entryGroupKind(p: PromptEntry): GroupKind | undefined {
  return activeGroups.value.find((g) => g.id === p.groupId)?.kind
}

function onInnerSlotEnabledToggle(inner: PromptEntry) {
  store.updatePrompt(inner.id, { enabled: !inner.enabled })
}

function duplicateCurrent() {
  if (!selected.value) return
  store.duplicatePrompt(selected.value.id)
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

const formatDate = formatPromptDate
</script>

<template>
        <!-- ====== Right editor ====== -->
        <section v-if="showEditorPane" class="prompts-editor">
          <div class="prompts-editor__panel">
          <button
            v-if="mobileMasterDetail"
            type="button"
            class="prompts-editor__back"
            @click="backToPromptList"
          >
            <v-icon size="18">mdi-chevron-left</v-icon>
            {{ $t('prompts.backToList') }}
          </button>
          <div class="prompts-editor__scroll">
          <template v-if="listBundleEditor">
            <div class="editor-card editor-card--binding">
              <section class="binding-editor__block">
                <header class="binding-editor__section-head">
                  <h2 class="binding-editor__block-title">
                    {{ $t(legacyBundleTitleKey(listBundleEditor.block.bindingSlot, entryGroupKind(listBundleEditor.block))) }}
                  </h2>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorBlockTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body group-bound-desc">
                  <p>
                    {{ $t(legacyBundleDescKey(listBundleEditor.block.bindingSlot, entryGroupKind(listBundleEditor.block))) }}
                  </p>
                  <p
                    v-if="showHistoryTokenTrim(entryGroupKind(listBundleEditor.block))"
                  >
                    {{ $t('prompts.groupBoundHistoryTokenTrim') }}
                  </p>
                  <p class="group-bound-desc__drag">
                    {{ $t('prompts.groupBoundDragHint') }}
                  </p>
                </div>
              </section>

              <section class="binding-editor__slot">
                <header
                  class="binding-editor__section-head binding-editor__section-head--slot"
                >
                  <button
                    v-if="bindingSlotAllowsToggle(listBundleEditor.slot.bindingSlot)"
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': listBundleEditor.slot.enabled }"
                    :aria-pressed="listBundleEditor.slot.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    :aria-label="$t('prompts.fieldEnabled')"
                    @click="onInnerSlotEnabledToggle(listBundleEditor.slot)"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <h3 class="binding-editor__slot-title">
                    {{ $t(bindingSlotLabelKey(listBundleEditor.slot.bindingSlot)) }}
                  </h3>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorSlotTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body">
                  <p>{{ $t(bindingSlotListHintKey(listBundleEditor.slot.bindingSlot)) }}</p>
                  <p>{{ $t(bindingSlotEditorDescKey(listBundleEditor.slot.bindingSlot)) }}</p>
                </div>
              </section>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('prompts.autosaveHint') }}</span>
              </footer>
            </div>
          </template>

          <template v-else-if="selected?.bindingSlot && bindingSlotUsesFlatSubBlockUi(selected.bindingSlot, entryGroupKind(selected), promptsInGroup(selected.groupId))">
            <div class="editor-card editor-card--binding">
              <section class="binding-editor__slot binding-editor__slot--standalone">
                <header
                  class="binding-editor__section-head binding-editor__section-head--slot"
                >
                  <button
                    v-if="!bindingSlotIsRequired(selected.bindingSlot)"
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': selected.enabled }"
                    :aria-pressed="selected.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    :aria-label="$t('prompts.fieldEnabled')"
                    @click="onEnabledToggle"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <h2 class="binding-editor__slot-title binding-editor__slot-title--standalone">
                    {{ $t(bindingSlotLabelKey(selected.bindingSlot)) }}
                  </h2>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorSlotTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body">
                  <p>{{ $t(bindingSlotListHintKey(selected.bindingSlot)) }}</p>
                  <p>{{ $t(bindingSlotEditorDescKey(selected.bindingSlot)) }}</p>
                  <template v-if="bindingSlotHasEditableContent(selected.bindingSlot)">
                    <div class="editor-card__field-row editor-card__field-row--role-pos">
                      <div class="editor-card__field-block">
                        <label class="editor-card__field-label">{{ $t('prompts.fieldRole') }}</label>
                        <div class="pill-group">
                          <button
                            v-for="opt in ROLE_OPTIONS"
                            :key="opt.id"
                            type="button"
                            class="pill"
                            :class="{ 'is-on': selected.role === opt.id, [`role-${opt.id}`]: true }"
                            @click="setRole(opt.id)"
                          >{{ $t(opt.key) }}</button>
                        </div>
                      </div>

                      <div class="editor-card__field-block">
                        <label class="editor-card__field-label">
                          {{ $t('prompts.fieldPosition') }}
                          <span class="editor-card__field-hint">
                            {{ selected.injectionPosition === 'relative'
                              ? $t('prompts.positionRelativeHint')
                              : $t('prompts.positionChatHint') }}
                          </span>
                        </label>
                        <div class="pill-group">
                          <button
                            type="button"
                            class="pill"
                            :class="{ 'is-on': selected.injectionPosition === 'relative' }"
                            @click="setPosition('relative')"
                          >{{ $t('prompts.positionRelative') }}</button>
                          <button
                            type="button"
                            class="pill"
                            :class="{ 'is-on': selected.injectionPosition === 'chat' }"
                            @click="setPosition('chat')"
                          >{{ $t('prompts.positionChat') }}</button>
                          <template v-if="selected.injectionPosition === 'chat'">
                            <span class="pill-divider" />
                            <span class="num-field">
                              <span class="num-field__label">{{ $t('prompts.fieldDepth') }}</span>
                              <input
                                v-model.number="depthDraft"
                                type="number"
                                min="0"
                                class="num-field__input"
                                :title="$t('prompts.depthHint')"
                                @blur="commitPromptEditorDraftsFromBlur()"
                              />
                            </span>
                            <span class="num-field">
                              <span class="num-field__label">{{ $t('prompts.fieldOrder') }}</span>
                              <input
                                v-model.number="orderDraft"
                                type="number"
                                class="num-field__input"
                                :title="$t('prompts.orderHint')"
                                @blur="commitPromptEditorDraftsFromBlur()"
                              />
                            </span>
                          </template>
                        </div>
                      </div>
                    </div>

                    <div class="editor-card__field">
                      <label class="editor-card__field-label">
                        {{ $t('prompts.fieldContent') }}
                        <span class="editor-card__field-hint">{{ $t('prompts.contentHint') }}</span>
                      </label>
                      <textarea
                        v-model="contentDraft"
                        class="editor-card__content-input"
                        rows="18"
                        spellcheck="false"
                        :placeholder="$t('prompts.contentPlaceholder')"
                        @blur="commitPromptEditorDraftsFromBlur()"
                      ></textarea>
                    </div>
                  </template>
                </div>
              </section>
              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('prompts.autosaveHint') }}</span>
              </footer>
            </div>
          </template>

          <template v-else-if="selected?.bindingSlot">
            <div class="editor-card editor-card--binding">
              <section class="binding-editor__block">
                <header class="binding-editor__section-head">
                  <h2 class="binding-editor__block-title">
                    {{ $t(legacyBundleTitleKey(selected.bindingSlot, entryGroupKind(selected))) }}
                  </h2>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorBlockTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body group-bound-desc">
                  <p>
                    {{ $t(legacyBundleDescKey(selected.bindingSlot, entryGroupKind(selected))) }}
                  </p>
                  <p
                    v-if="
                      selected.bindingSlot === 'boundCharacterPostHistory' &&
                      showHistoryTokenTrim(entryGroupKind(selected))
                    "
                  >
                    {{ $t('prompts.groupBoundHistoryTokenTrim') }}
                  </p>
                  <p class="group-bound-desc__drag">
                    {{ $t('prompts.groupBoundDragHint') }}
                  </p>
                </div>
              </section>

              <section class="binding-editor__slot">
                <header
                  class="binding-editor__section-head binding-editor__section-head--slot"
                >
                  <button
                    v-if="!bindingSlotIsRequired(selected.bindingSlot)"
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': selected.enabled }"
                    :aria-pressed="selected.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    :aria-label="$t('prompts.fieldEnabled')"
                    @click="onEnabledToggle"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <h3 class="binding-editor__slot-title">
                    {{ $t(bindingSlotLabelKey(selected.bindingSlot)) }}
                  </h3>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorSlotTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body">
                  <p>{{ $t(bindingSlotListHintKey(selected.bindingSlot)) }}</p>
                  <p>{{ $t(bindingSlotEditorDescKey(selected.bindingSlot)) }}</p>
                </div>
              </section>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('prompts.autosaveHint') }}</span>
              </footer>
            </div>
          </template>

          <template v-else-if="selected">
            <div class="editor-card">
              <header class="editor-card__head">
                <div class="editor-card__head-row">
                  <button
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': selected.enabled }"
                    :aria-pressed="selected.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    @click="onEnabledToggle"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <input
                    ref="titleInputRef"
                    v-model="titleDraft"
                    type="text"
                    class="editor-card__title-input"
                    :placeholder="$t('prompts.titlePlaceholder')"
                    :aria-label="$t('prompts.fieldTitle')"
                    @blur="commitPromptEditorDraftsFromBlur()"
                  />
                  <span v-if="selected.isSeed" class="editor-card__seed">
                    {{ $t('prompts.seedTag') }}
                  </span>
                </div>
                <input
                  v-model="descriptionDraft"
                  type="text"
                  class="editor-card__description-input"
                  :placeholder="$t('prompts.descriptionPlaceholder')"
                  :aria-label="$t('prompts.fieldDescription')"
                  @blur="commitPromptEditorDraftsFromBlur()"
                />
                <div class="editor-card__meta">
                  <span>
                    <span class="editor-card__meta-label">{{ $t('prompts.fieldGroup') }}</span>
                    {{ entryGroupName(selected) }}
                  </span>
                  <span>
                    <span class="editor-card__meta-label">{{ $t('prompts.fieldUpdatedAt') }}</span>
                    {{ formatDate(selected.updatedAt) }}
                  </span>
                  <span>
                    <span class="editor-card__meta-label">{{ $t('prompts.fieldChars') }}</span>
                    {{ selected.content.length }}
                  </span>
                </div>
              </header>

              <div class="editor-card__field-row editor-card__field-row--role-pos">
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">{{ $t('prompts.fieldRole') }}</label>
                  <div class="pill-group">
                    <button
                      v-for="opt in ROLE_OPTIONS"
                      :key="opt.id"
                      type="button"
                      class="pill"
                      :class="{ 'is-on': selected.role === opt.id, [`role-${opt.id}`]: true }"
                      @click="setRole(opt.id)"
                    >{{ $t(opt.key) }}</button>
                  </div>
                </div>

                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">
                    {{ $t('prompts.fieldPosition') }}
                    <span class="editor-card__field-hint">
                      {{ selected.injectionPosition === 'relative'
                        ? $t('prompts.positionRelativeHint')
                        : $t('prompts.positionChatHint') }}
                    </span>
                  </label>
                  <div class="pill-group">
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': selected.injectionPosition === 'relative' }"
                      @click="setPosition('relative')"
                    >{{ $t('prompts.positionRelative') }}</button>
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': selected.injectionPosition === 'chat' }"
                      @click="setPosition('chat')"
                    >{{ $t('prompts.positionChat') }}</button>
                    <template v-if="selected.injectionPosition === 'chat'">
                      <span class="pill-divider" />
                      <span class="num-field">
                        <span class="num-field__label">{{ $t('prompts.fieldDepth') }}</span>
                        <input
                          v-model.number="depthDraft"
                          type="number"
                          min="0"
                          class="num-field__input"
                          :title="$t('prompts.depthHint')"
                          @blur="commitPromptEditorDraftsFromBlur()"
                        />
                      </span>
                      <span class="num-field">
                        <span class="num-field__label">{{ $t('prompts.fieldOrder') }}</span>
                        <input
                          v-model.number="orderDraft"
                          type="number"
                          class="num-field__input"
                          :title="$t('prompts.orderHint')"
                          @blur="commitPromptEditorDraftsFromBlur()"
                        />
                      </span>
                    </template>
                  </div>
                </div>
              </div>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('prompts.fieldTriggers') }}
                  <span class="editor-card__field-hint">{{ $t('prompts.triggersHint') }}</span>
                </label>
                <div class="pill-group">
                  <button
                    v-for="opt in TRIGGER_OPTIONS"
                    :key="opt.id"
                    type="button"
                    class="pill pill--check"
                    :class="{ 'is-on': selected.triggers.includes(opt.id) }"
                    @click="toggleTrigger(opt.id)"
                  >
                    <span class="pill__tick">{{ selected.triggers.includes(opt.id) ? '✓' : '' }}</span>
                    {{ $t(opt.key) }}
                  </button>
                </div>
              </div>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('prompts.fieldTags') }}
                  <span class="editor-card__field-hint">{{ $t('prompts.tagsHint') }}</span>
                </label>
                <input
                  v-model="tagsInputDraft"
                  type="text"
                  class="editor-card__tags-input"
                  :placeholder="$t('prompts.tagsPlaceholder')"
                  @blur="commitTagsDraft()"
                />
              </div>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('prompts.fieldContent') }}
                  <span class="editor-card__field-hint">{{ $t('prompts.contentHint') }}</span>
                </label>
                <textarea
                  v-model="contentDraft"
                  class="editor-card__content-input"
                  rows="18"
                  spellcheck="false"
                  :placeholder="$t('prompts.contentPlaceholder')"
                  @blur="commitPromptEditorDraftsFromBlur()"
                ></textarea>
              </div>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('prompts.autosaveHint') }}</span>
                <span class="editor-card__actions">
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="duplicateCurrent"
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
                  >{{ $t('prompts.deletePrompt') }}</button>
                </span>
              </footer>
            </div>
          </template>

          <template v-else>
            <div class="editor-empty">
              <v-icon size="44" class="editor-empty__icon">
                {{ currentGroup ? groupIcon(currentGroup.kind) : 'mdi-file-document-outline' }}
              </v-icon>
              <h2 class="editor-empty__title">
                {{ currentGroup && !isEntryListGroup
                  ? $t(groupBoundTitleKey(currentGroup.kind))
                  : $t('prompts.editorEmptyTitle') }}
              </h2>
              <p
                v-if="currentGroup && !isEntryListGroup"
                class="editor-empty__hint group-bound-desc"
              >
                <span class="group-bound-desc__line">{{
                  $t(groupBoundDescKey(currentGroup.kind))
                }}</span>
                <span
                  v-if="showHistoryTokenTrim(currentGroup.kind)"
                  class="group-bound-desc__line"
                >{{ $t('prompts.groupBoundHistoryTokenTrim') }}</span>
                <span class="group-bound-desc__line group-bound-desc__drag">{{
                  $t('prompts.groupBoundDragHint')
                }}</span>
              </p>
              <p v-else class="editor-empty__hint">
                {{ $t('prompts.editorEmptyHint') }}
              </p>
              <button
                v-if="isEntryListGroup"
                type="button"
                class="editor-empty__cta"
                @click="createEntry"
              >+ {{ $t('prompts.newPrompt') }}</button>
            </div>
          </template>
          </div>
          </div>
        </section>
</template>
