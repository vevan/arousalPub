<script setup lang="ts">
import { useRegexRulesStore } from '@/stores/regex-rules'
import type { RegexField, RegexPhase, RegexRule } from '@/types/regex-rules'
import {
  cloneRegexRule,
  createDefaultRegexRule,
  MAX_REGEX_LABEL_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  MAX_REGEX_REPLACEMENT_LENGTH,
  REGEX_FIELD_OPTIONS,
  REGEX_PHASE_OPTIONS,
  runRegexPipelinePlainTextTest,
  sortRegexRules,
  type RegexPipelineRuleStat,
  validateRegexPatternClient,
} from '@/utils/regex-rules'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const store = useRegexRulesStore()
const { loading, saving } = storeToRefs(store)

const rulesList = ref<RegexRule[]>([])
const listSaving = ref(false)
const errorText = ref('')

const dragIndex = ref<number | null>(null)
const deleteOpen = ref(false)
const deleteTargetId = ref<string | null>(null)

const editOpen = ref(false)
const editDraft = ref<RegexRule | null>(null)
const editError = ref('')
const editSaving = ref(false)

const testInput = ref('')
const testError = ref('')
const testOutput = ref('')

const pipelineOpen = ref(false)
const pipelineInput = ref('')
const pipelineOutput = ref('')
const pipelineStats = ref<Map<string, RegexPipelineRuleStat> | null>(null)

const pipelineRulesSorted = computed(() => sortRegexRules(rulesList.value))

const patternError = computed(() => {
  const rule = editDraft.value
  if (!rule) return ''
  const code = validateRegexPatternClient(rule.pattern, rule.flags)
  if (!code) return ''
  return t(`settings.regexRules.validation.${code}`)
})

function phaseTitle(phase: RegexPhase): string {
  return t(`settings.regexRules.phase.${phase}`)
}

function fieldTitle(field: RegexField): string {
  return t(`settings.regexRules.field.${field}`)
}

function ruleTitle(rule: RegexRule): string {
  return rule.label.trim() || t('settings.regexRules.untitled')
}

function syncListFromStore() {
  rulesList.value = store.sortedRules.map((r) => cloneRegexRule(r))
}

async function loadRules() {
  errorText.value = ''
  try {
    await store.loadFromServer(true)
    syncListFromStore()
  } catch (e) {
    errorText.value = t('settings.regexRules.loadFailed')
    console.warn('[regex-rules-settings] load', e)
  }
}

async function persistList() {
  listSaving.value = true
  errorText.value = ''
  const snapshot = rulesList.value.map((r) => cloneRegexRule(r))
  try {
    await store.persistRulesList(snapshot)
    syncListFromStore()
  } catch (e) {
    errorText.value = t('settings.regexRules.saveFailed')
    console.warn('[regex-rules-settings] persist', e)
  } finally {
    listSaving.value = false
  }
}

function onDragStart(index: number) {
  dragIndex.value = index
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

function onDragEnd() {
  dragIndex.value = null
}

function onDrop(index: number) {
  const from = dragIndex.value
  dragIndex.value = null
  if (from == null || from === index) return
  const list = [...rulesList.value]
  const [item] = list.splice(from, 1)
  if (!item) return
  list.splice(index, 0, item)
  rulesList.value = list
  void persistList()
}

function onToggleEnabled(rule: RegexRule, enabled: boolean | null) {
  if (enabled === null) return
  rule.enabled = enabled
  void persistList()
}

function openEdit(rule: RegexRule) {
  editDraft.value = cloneRegexRule(rule)
  editError.value = ''
  testError.value = ''
  testOutput.value = ''
  editOpen.value = true
}

function closeEdit() {
  editOpen.value = false
  editDraft.value = null
  editError.value = ''
}

function onAddRule() {
  const rule = createDefaultRegexRule(rulesList.value)
  rulesList.value = [...rulesList.value, rule]
  openEdit(rule)
}

async function saveEdit() {
  const draft = editDraft.value
  if (!draft) return
  const patternErr = validateRegexPatternClient(draft.pattern, draft.flags)
  if (patternErr) {
    editError.value = t(`settings.regexRules.validation.${patternErr}`)
    return
  }
  if (draft.phases.length === 0 || draft.fields.length === 0) {
    editError.value = t('settings.regexRules.validation.phases_fields_required')
    return
  }
  editError.value = ''
  editSaving.value = true
  const idx = rulesList.value.findIndex((r) => r.id === draft.id)
  if (idx < 0) {
    rulesList.value = [...rulesList.value, cloneRegexRule(draft)]
  } else {
    rulesList.value[idx] = cloneRegexRule(draft)
  }
  try {
    await persistList()
    closeEdit()
  } catch {
    editError.value = t('settings.regexRules.saveFailed')
  } finally {
    editSaving.value = false
  }
}

function patchDraft(patch: Partial<RegexRule>) {
  if (!editDraft.value) return
  editDraft.value = {
    ...editDraft.value,
    ...patch,
    phases: patch.phases ? [...patch.phases] : editDraft.value.phases,
    fields: patch.fields ? [...patch.fields] : editDraft.value.fields,
  }
}

function runTest() {
  const rule = editDraft.value
  testError.value = ''
  testOutput.value = ''
  if (!rule) return
  const patternErr = validateRegexPatternClient(rule.pattern, rule.flags)
  if (patternErr) {
    testError.value = t(`settings.regexRules.validation.${patternErr}`)
    return
  }
  try {
    const re = new RegExp(rule.pattern, rule.flags)
    testOutput.value = testInput.value.replace(re, rule.replacement)
  } catch {
    testError.value = t('settings.regexRules.validation.invalid_regexp')
  }
}

function openPipelineTest() {
  pipelineOpen.value = true
  pipelineInput.value = ''
  pipelineOutput.value = ''
  pipelineStats.value = null
}

function runPipelineTest() {
  const result = runRegexPipelinePlainTextTest(pipelineInput.value, rulesList.value)
  pipelineOutput.value = result.output
  pipelineStats.value = new Map(result.stats.map((s) => [s.ruleId, s]))
}

function pipelineStatLabel(ruleId: string): string {
  const stat = pipelineStats.value?.get(ruleId)
  if (!stat) return ''
  if (stat.outcome === 'skipped_disabled') {
    return t('settings.regexRules.pipelineTestSkipped')
  }
  if (stat.outcome === 'no_match') return t('settings.regexRules.pipelineTestNoMatch')
  return t('settings.regexRules.pipelineTestHit', { count: stat.hitCount })
}

function openDelete(id: string) {
  deleteTargetId.value = id
  deleteOpen.value = true
}

async function confirmDelete() {
  if (deleteTargetId.value) {
    if (editDraft.value?.id === deleteTargetId.value) closeEdit()
    rulesList.value = rulesList.value.filter((r) => r.id !== deleteTargetId.value)
    await persistList()
  }
  deleteOpen.value = false
  deleteTargetId.value = null
}

function cancelDelete() {
  deleteOpen.value = false
  deleteTargetId.value = null
}

watch(editOpen, (open) => {
  if (!open) {
    testError.value = ''
    testOutput.value = ''
  }
})

onMounted(() => {
  void loadRules()
})
</script>

<template>
  <section class="settings-section regex-rules-panel">
    <h2 class="text-subtitle-1 font-weight-medium mb-2">
      {{ $t('settings.regexRules.section') }}
    </h2>
    <p class="text-body-2 text-medium-emphasis mb-4">
      {{ $t('settings.regexRules.sectionHint') }}
    </p>

    <v-alert
      v-if="errorText"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3"
    >
      {{ errorText }}
    </v-alert>

    <v-progress-linear
      v-if="loading || listSaving || saving"
      indeterminate
      color="primary"
      class="mb-3"
    />

    <div class="regex-rules-panel__toolbar mb-3">
      <v-btn
        color="primary"
        variant="flat"
        size="small"
        class="text-none"
        prepend-icon="mdi-plus"
        :disabled="loading"
        @click="onAddRule"
      >
        {{ $t('settings.regexRules.addRule') }}
      </v-btn>
      <v-btn
        variant="tonal"
        size="small"
        class="text-none ms-2"
        prepend-icon="mdi-playlist-play"
        :disabled="loading || rulesList.length === 0"
        @click="openPipelineTest"
      >
        {{ $t('settings.regexRules.pipelineTest') }}
      </v-btn>
      <span
        v-if="listSaving || saving"
        class="text-caption text-medium-emphasis ms-2"
      >
        {{ $t('settings.regexRules.saving') }}
      </span>
    </div>

    <v-list
      v-if="!loading && rulesList.length > 0"
      class="regex-rules-panel__list rounded-lg border"
      density="comfortable"
    >
      <v-list-item
        v-for="(rule, index) in rulesList"
        :key="rule.id"
        draggable="true"
        class="regex-rules-panel__item"
        :class="{ 'regex-rules-panel__item--dragging': dragIndex === index }"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver"
        @dragend="onDragEnd"
        @drop="onDrop(index)"
      >
        <template #prepend>
          <div class="regex-rules-panel__leading">
            <v-icon
              class="regex-rules-panel__drag"
              size="18"
              :title="$t('prompts.dragHandle')"
            >
              mdi-drag-vertical
            </v-icon>
            <v-tooltip
              location="top"
              :text="$t('settings.regexRules.editRule')"
            >
              <template #activator="{ props: tooltipProps }">
                <v-icon-btn
                  v-bind="tooltipProps"
                  icon="mdi-pencil-outline"
                  variant="text"
                  color="primary"
                  size="small"
                  :icon-size="22"
                  :aria-label="$t('settings.regexRules.editRule')"
                  @click.stop="openEdit(rule)"
                  @dragstart.stop
                />
              </template>
            </v-tooltip>
          </div>
        </template>

        <v-list-item-title class="font-weight-medium">
          {{ ruleTitle(rule) }}
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption">
          {{ rule.pattern || $t('settings.regexRules.noPattern') }}
        </v-list-item-subtitle>

        <template #append>
          <div class="regex-rules-panel__actions">
            <v-switch
              :model-value="rule.enabled"
              color="primary"
              density="compact"
              hide-details
              :aria-label="$t('settings.regexRules.enabledAria', { name: ruleTitle(rule) })"
              @update:model-value="onToggleEnabled(rule, $event)"
              @click.stop
              @dragstart.stop
            />
            <v-tooltip
              location="top"
              :text="$t('settings.regexRules.deleteRule')"
            >
              <template #activator="{ props: tooltipProps }">
                <v-icon-btn
                  v-bind="tooltipProps"
                  icon="mdi-delete-outline"
                  variant="text"
                  color="error"
                  size="small"
                  :icon-size="24"
                  @click.stop="openDelete(rule.id)"
                  @dragstart.stop
                />
              </template>
            </v-tooltip>
          </div>
        </template>
      </v-list-item>
    </v-list>

    <p
      v-else-if="!loading"
      class="text-body-2 text-medium-emphasis"
    >
      {{ $t('settings.regexRules.empty') }}
    </p>

    <v-dialog
      v-model="editOpen"
      max-width="640"
      scrollable
      @click:outside="closeEdit"
    >
      <v-card v-if="editDraft">
        <v-card-title class="text-h6">
          {{ ruleTitle(editDraft) }}
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4">
          <v-alert
            v-if="editError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            {{ editError }}
          </v-alert>

          <v-text-field
            :model-value="editDraft.label"
            :label="$t('settings.regexRules.label')"
            :maxlength="MAX_REGEX_LABEL_LENGTH"
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="mb-3"
            @update:model-value="patchDraft({ label: String($event ?? '') })"
          />

          <v-text-field
            :model-value="editDraft.pattern"
            :label="$t('settings.regexRules.pattern')"
            :maxlength="MAX_REGEX_PATTERN_LENGTH"
            density="comfortable"
            variant="outlined"
            :error-messages="patternError ? [patternError] : []"
            hide-details="auto"
            class="mb-3"
            @update:model-value="patchDraft({ pattern: String($event ?? '') })"
          />

          <div class="regex-rules-panel__row mb-3">
            <v-text-field
              :model-value="editDraft.flags"
              :label="$t('settings.regexRules.flags')"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="regex-rules-panel__flags"
              @update:model-value="patchDraft({ flags: String($event ?? '') })"
            />
            <v-text-field
              :model-value="editDraft.replacement"
              :label="$t('settings.regexRules.replacement')"
              :maxlength="MAX_REGEX_REPLACEMENT_LENGTH"
              density="comfortable"
              variant="outlined"
              hide-details="auto"
              class="regex-rules-panel__replacement"
              @update:model-value="patchDraft({ replacement: String($event ?? '') })"
            />
          </div>

          <v-select
            :model-value="editDraft.phases"
            :items="REGEX_PHASE_OPTIONS"
            :label="$t('settings.regexRules.phases')"
            item-title="value"
            item-value="value"
            multiple
            chips
            closable-chips
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="mb-3"
            @update:model-value="patchDraft({ phases: $event as RegexPhase[] })"
          >
            <template #chip="{ item }">
              <v-chip size="small">
                {{ phaseTitle(item.value as RegexPhase) }}
              </v-chip>
            </template>
            <template #item="{ props: itemProps, item }">
              <v-list-item
                v-bind="itemProps"
                :title="phaseTitle(item.value as RegexPhase)"
              />
            </template>
          </v-select>

          <v-select
            :model-value="editDraft.fields"
            :items="REGEX_FIELD_OPTIONS"
            :label="$t('settings.regexRules.fields')"
            item-title="value"
            item-value="value"
            multiple
            chips
            closable-chips
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="mb-3"
            @update:model-value="patchDraft({ fields: $event as RegexField[] })"
          >
            <template #chip="{ item }">
              <v-chip size="small">
                {{ fieldTitle(item.value as RegexField) }}
              </v-chip>
            </template>
            <template #item="{ props: itemProps, item }">
              <v-list-item
                v-bind="itemProps"
                :title="fieldTitle(item.value as RegexField)"
              />
            </template>
          </v-select>

          <v-text-field
            :model-value="editDraft.skipLastNTurns"
            type="number"
            min="0"
            step="1"
            :label="$t('settings.regexRules.skipLastNTurns')"
            :hint="$t('settings.regexRules.skipLastNTurnsHint')"
            persistent-hint
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="mb-4"
            @update:model-value="patchDraft({
              skipLastNTurns: Math.max(0, Math.trunc(Number($event) || 0)),
            })"
          />

          <v-divider class="mb-4" />

          <h4 class="text-body-2 font-weight-medium mb-2">
            {{ $t('settings.regexRules.testTitle') }}
          </h4>
          <p class="text-caption text-medium-emphasis mb-3">
            {{ $t('settings.regexRules.testHint') }}
          </p>

          <v-textarea
            v-model="testInput"
            :label="$t('settings.regexRules.testInput')"
            rows="3"
            auto-grow
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="mb-3"
          />

          <v-btn
            color="primary"
            variant="tonal"
            size="small"
            class="text-none mb-3"
            @click="runTest"
          >
            {{ $t('settings.regexRules.testRun') }}
          </v-btn>

          <v-alert
            v-if="testError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            {{ testError }}
          </v-alert>

          <v-textarea
            v-if="testOutput"
            :model-value="testOutput"
            :label="$t('settings.regexRules.testOutput')"
            rows="3"
            auto-grow
            readonly
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn
            variant="tonal"
            size="small"
            class="text-none"
            :disabled="editSaving"
            @click="closeEdit"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="editSaving"
            @click="saveEdit"
          >
            {{ $t('settings.regexRules.saveRule') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="deleteOpen"
      max-width="400"
    >
      <v-card>
        <v-card-title class="text-h6">
          {{ $t('settings.regexRules.deleteConfirmTitle') }}
        </v-card-title>
        <v-card-text>
          {{ $t('settings.regexRules.deleteConfirmBody') }}
        </v-card-text>
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn
            variant="tonal"
            size="small"
            class="text-none"
            @click="cancelDelete"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            size="small"
            @click="confirmDelete"
          >
            {{ $t('settings.regexRules.deleteRule') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="pipelineOpen"
      max-width="720"
      scrollable
    >
      <v-card>
        <v-card-title class="text-h6">
          {{ $t('settings.regexRules.pipelineTestTitle') }}
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-4">
          <p class="text-caption text-medium-emphasis mb-3">
            {{ $t('settings.regexRules.pipelineTestHint') }}
          </p>

          <v-textarea
            v-model="pipelineInput"
            :label="$t('settings.regexRules.pipelineTestInput')"
            rows="4"
            auto-grow
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            class="mb-3"
          />

          <v-btn
            color="primary"
            variant="flat"
            size="small"
            class="text-none mb-3"
            @click="runPipelineTest"
          >
            {{ $t('settings.regexRules.pipelineTestRun') }}
          </v-btn>

          <v-list
            class="regex-rules-panel__pipeline-list rounded-lg border mb-3"
            density="compact"
          >
            <v-list-item
              v-for="rule in pipelineRulesSorted"
              :key="rule.id"
            >
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ ruleTitle(rule) }}
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                {{ rule.pattern || $t('settings.regexRules.noPattern') }}
              </v-list-item-subtitle>
              <template #append>
                <div class="regex-rules-panel__pipeline-meta">
                  <span
                    v-if="pipelineStats"
                    class="text-caption regex-rules-panel__pipeline-stat"
                    :class="{
                      'text-medium-emphasis': pipelineStats.get(rule.id)?.outcome === 'skipped_disabled',
                      'text-success': pipelineStats.get(rule.id)?.outcome === 'hit',
                    }"
                  >
                    {{ pipelineStatLabel(rule.id) }}
                  </span>
                  <span
                    class="regex-rules-panel__pipeline-badge"
                    :class="rule.enabled
                      ? 'regex-rules-panel__pipeline-badge--on'
                      : 'regex-rules-panel__pipeline-badge--off'"
                  >
                    {{
                      rule.enabled
                        ? $t('settings.regexRules.pipelineTestEnabled')
                        : $t('settings.regexRules.pipelineTestDisabled')
                    }}
                  </span>
                </div>
              </template>
            </v-list-item>
          </v-list>

          <v-textarea
            v-if="pipelineStats"
            :model-value="pipelineOutput"
            :label="$t('settings.regexRules.pipelineTestOutput')"
            rows="4"
            auto-grow
            readonly
            density="comfortable"
            variant="outlined"
            hide-details
          />
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-3">
          <v-spacer />
          <v-btn
            variant="tonal"
            size="small"
            class="text-none"
            @click="pipelineOpen = false"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.regex-rules-panel__list {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.regex-rules-panel__item {
  cursor: grab;
}

.regex-rules-panel__item--dragging {
  opacity: 0.55;
}

.regex-rules-panel__drag {
  opacity: 0.45;
  margin-inline-end: 0.25rem;
}

.regex-rules-panel__leading {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  margin-inline-end: 0.25rem;
}

.regex-rules-panel__item :deep(.v-list-item__prepend) {
  width: auto;
}

.regex-rules-panel__item :deep(.v-list-item__append) {
  padding-inline-start: 0.5rem;
}

.regex-rules-panel__actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
}

.regex-rules-panel__actions :deep(.v-switch) {
  flex-shrink: 0;
}

.regex-rules-panel__row {
  display: grid;
  grid-template-columns: minmax(5rem, 7rem) 1fr;
  gap: 0.75rem;
}

.regex-rules-panel__pipeline-list {
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.regex-rules-panel__pipeline-list :deep(.v-list-item) {
  align-items: center;
}

.regex-rules-panel__pipeline-list :deep(.v-list-item__append) {
  align-self: center;
}

.regex-rules-panel__pipeline-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}

.regex-rules-panel__pipeline-stat {
  display: inline-flex;
  align-items: center;
  line-height: 1;
  white-space: nowrap;
}

.regex-rules-panel__pipeline-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 1.25rem;
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  line-height: 1;
  white-space: nowrap;
}

.regex-rules-panel__pipeline-badge--on {
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.12);
}

.regex-rules-panel__pipeline-badge--off {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

@media (max-width: 600px) {
  .regex-rules-panel__row {
    grid-template-columns: 1fr;
  }
}
</style>
