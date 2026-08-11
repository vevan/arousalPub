<script setup lang="ts">
import type { AltGreetRow } from '@/composables/characters/types'

defineProps<{
  open: boolean
  title: string
  hint: string
  saveLabel: string
  doing: boolean
  dialogError: string
  nameError: string
  editPortraitSrc: string
  name: string
  description: string
  tags: string
  creator: string
  personality: string
  scenario: string
  firstMes: string
  mesExample: string
  creatorNotes: string
  system: string
  post: string
  alternateGreetings: AltGreetRow[]
  altGreetingPanelOpen: string[]
  altGreetingStats: { total: number; filled: number }
  altGreetingPreview: (text: string) => string
  bindPortraitInput: (el: Element | null) => void
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:dialogError': [value: string]
  'update:name': [value: string]
  'update:description': [value: string]
  'update:tags': [value: string]
  'update:creator': [value: string]
  'update:personality': [value: string]
  'update:scenario': [value: string]
  'update:firstMes': [value: string]
  'update:mesExample': [value: string]
  'update:creatorNotes': [value: string]
  'update:system': [value: string]
  'update:post': [value: string]
  'update:altGreetingPanelOpen': [value: string[]]
  'portrait-change': [ev: Event]
  'trigger-portrait': []
  'add-alt-greeting': []
  'remove-alt-greeting': [rowId: string]
  submit: []
}>()
</script>

<template>
  <v-dialog
    :model-value="open"
    scrollable
    content-class="char-edit-dialog-surface"
    @update:model-value="emit('update:open', $event)"
    @keydown.esc="emit('update:open', false)"
  >
    <v-card class="charlib-edit-card">
      <v-card-title class="charlib-edit-card__title">{{ title }}</v-card-title>
      <v-card-text class="charlib-edit-card__body scroll-y-nice">
        <p class="text-body-2 text-medium-emphasis mb-3">
          {{ hint }}
        </p>
        <v-alert
          v-if="dialogError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
          closable
          @click:close="emit('update:dialogError', '')"
        >
          {{ dialogError }}
        </v-alert>

        <div class="charlib-edit-grid">
          <div
            class="charlib-edit-col charlib-edit-col--left charlib-edit-col--scroll scroll-y-nice"
          >
            <div class="charlib-edit-portrait-block">
              <img
                v-if="editPortraitSrc"
                class="charlib-edit-portrait-img"
                :src="editPortraitSrc"
                alt=""
              />
              <div
                v-else
                class="charlib-edit-portrait text-caption text-medium-emphasis"
              >
                {{ $t('characters.portraitPlaceholder') }}
              </div>
              <input
                :ref="(el) => bindPortraitInput(el as Element | null)"
                type="file"
                accept="image/png,.png"
                class="d-none"
                @change="emit('portrait-change', $event)"
              />
              <v-btn
                variant="tonal"
                size="small"
                class="mt-2"
                @click="emit('trigger-portrait')"
              >
                {{ $t('characters.portraitPick') }}
              </v-btn>
              <p class="text-caption text-medium-emphasis mt-1 mb-0">
                {{ $t('characters.portraitPickHint') }}
              </p>
            </div>
            <v-text-field
              :model-value="name"
              :label="$t('characters.fieldName')"
              :error-messages="nameError"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              @update:model-value="emit('update:name', $event)"
            />
            <v-textarea
              :model-value="description"
              :label="$t('characters.fieldDescription')"
              variant="outlined"
              rows="4"
              auto-grow
              hide-details="auto"
              @update:model-value="emit('update:description', $event)"
            />
            <v-text-field
              :model-value="tags"
              :label="$t('characters.fieldTags')"
              :hint="$t('characters.fieldTagsHint')"
              variant="outlined"
              density="comfortable"
              persistent-hint
              @update:model-value="emit('update:tags', $event)"
            />
            <v-text-field
              :model-value="creator"
              :label="$t('characters.fieldCreator')"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              @update:model-value="emit('update:creator', $event)"
            />
          </div>
          <div
            class="charlib-edit-col charlib-edit-col--right charlib-edit-col--scroll scroll-y-nice"
          >
            <v-textarea
              :model-value="personality"
              :label="$t('characters.fieldPersonality')"
              variant="outlined"
              rows="5"
              auto-grow
              hide-details="auto"
              @update:model-value="emit('update:personality', $event)"
            />
            <v-textarea
              :model-value="scenario"
              :label="$t('characters.fieldScenario')"
              variant="outlined"
              rows="4"
              auto-grow
              hide-details="auto"
              @update:model-value="emit('update:scenario', $event)"
            />
            <v-textarea
              :model-value="firstMes"
              :label="$t('characters.fieldFirstMes')"
              variant="outlined"
              rows="3"
              auto-grow
              hide-details="auto"
              @update:model-value="emit('update:firstMes', $event)"
            />
            <div class="charlib-altg">
              <div class="charlib-altg__toolbar">
                <span class="charlib-altg__label text-body-2">{{
                  $t('characters.fieldAlternateGreetings')
                }}</span>
                <v-chip size="small" variant="tonal" class="charlib-altg__chip">
                  {{
                    $t('characters.altGreetingCount', {
                      filled: altGreetingStats.filled,
                      total: altGreetingStats.total,
                    })
                  }}
                </v-chip>
                <v-spacer />
                <v-btn
                  type="button"
                  size="small"
                  variant="tonal"
                  @click="emit('add-alt-greeting')"
                >
                  {{ $t('characters.altGreetingAdd') }}
                </v-btn>
              </div>
              <p class="text-caption text-medium-emphasis mb-2">
                {{ $t('characters.fieldAlternateGreetingsHint') }}
              </p>
              <div class="charlib-altg__scroll scroll-y-nice">
                <v-expansion-panels
                  :model-value="altGreetingPanelOpen"
                  multiple
                  variant="accordion"
                  @update:model-value="emit('update:altGreetingPanelOpen', $event as string[])"
                >
                  <v-expansion-panel
                    v-for="(row, idx) in alternateGreetings"
                    :key="row.id"
                    :value="row.id"
                    class="charlib-altg__panel"
                  >
                    <v-expansion-panel-title class="charlib-altg__panel-title">
                      <span class="charlib-altg__panel-idx">#{{ idx + 1 }}</span>
                      <span class="charlib-altg__panel-preview text-medium-emphasis">{{
                        altGreetingPreview(row.text)
                      }}</span>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <div class="charlib-altg__panel-body">
                        <v-textarea
                          v-model="row.text"
                          variant="outlined"
                          rows="3"
                          auto-grow
                          hide-details="auto"
                          density="comfortable"
                        />
                        <v-btn
                          type="button"
                          class="mt-2"
                          size="small"
                          variant="text"
                          color="error"
                          @click="emit('remove-alt-greeting', row.id)"
                        >
                          {{ $t('characters.altGreetingRemove') }}
                        </v-btn>
                      </div>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
              </div>
            </div>
            <v-textarea
              :model-value="mesExample"
              :label="$t('characters.fieldMesExample')"
              variant="outlined"
              rows="4"
              auto-grow
              hide-details="auto"
              @update:model-value="emit('update:mesExample', $event)"
            />
            <v-textarea
              :model-value="creatorNotes"
              :label="$t('characters.fieldCreatorNotes')"
              variant="outlined"
              rows="3"
              auto-grow
              hide-details="auto"
              @update:model-value="emit('update:creatorNotes', $event)"
            />
            <v-textarea
              :model-value="system"
              :label="$t('characters.fieldSystem')"
              variant="outlined"
              rows="5"
              auto-grow
              hide-details="auto"
              @update:model-value="emit('update:system', $event)"
            />
            <v-textarea
              :model-value="post"
              :label="$t('characters.fieldPostHistory')"
              variant="outlined"
              rows="4"
              auto-grow
              hide-details="auto"
              @update:model-value="emit('update:post', $event)"
            />
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="doing" @click="emit('update:open', false)">
          {{ $t('characters.cancel') }}
        </v-btn>
        <v-btn color="primary" :loading="doing" @click="emit('submit')">
          {{ saveLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.charlib-edit-card {
  width: 100%;
  max-width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  max-height: 100%;
  min-height: 0;
  border-radius: 0.625rem !important;
  overflow: hidden;
}

@media (max-width: 40rem) {
  .charlib-edit-card {
    border-radius: 0 !important;
  }

  .charlib-edit-card :deep(.v-card-text) {
    padding: 1em 0.5em 0.5em !important;
  }

  .charlib-edit-card :deep(.v-field__input) {
    padding-inline: 0.5rem;
  }
}

.charlib-edit-card__title {
  flex-shrink: 0;
  padding-inline: 1.125rem;
}

.charlib-edit-card__body {
  padding: 1.125rem;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.charlib-edit-card :deep(.v-card-actions) {
  flex-shrink: 0;
  padding-inline: 1.125rem;
}

.charlib-edit-card :deep(.v-field.v-field--active .v-label.v-field-label--floating) {
  position: sticky;
  top: 0;
  background: rgb(var(--v-theme-surface));
  padding: 0.5em;
  opacity: 1;
  z-index: 1;
  border-radius: var(--radius-sm);
}

.charlib-edit-card :deep(.v-field) {
  border-radius: 0.375rem;
}

.charlib-edit-grid {
  display: grid;
  grid-template-columns: minmax(8.25rem, 0.42fr) minmax(16.25rem, 1.58fr);
  gap: 1.375rem 1.625rem;
  align-items: start;
  width: 100%;
}

@media (max-width: 40rem) {
  .charlib-edit-grid {
    grid-template-columns: 1fr;
  }
}

.charlib-edit-col {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
}

.charlib-edit-col--right {
  padding-top: 0.25rem;
}

.charlib-edit-col--scroll {
  overflow: visible;
  min-height: 0;
  padding-right: 0.25rem;
}

/* 编辑弹窗左右栏：覆盖 .scroll-y-nice 的 stable，未超高时不预留滚动条位；超高时才出现滚动条 */
.charlib-edit-col--scroll.scroll-y-nice {
  scrollbar-gutter: auto;
}

.charlib-edit-portrait {
  width: 100%;
  max-width: 8rem;
  aspect-ratio: 3 / 4;
  margin: 0 auto;
  border-radius: 0.625rem;
  border: 0.0625rem dashed rgba(var(--v-theme-on-surface), 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0.625rem;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.charlib-edit-portrait-block {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  max-width: 10rem;
  margin: 0 auto 0.25rem;
}

.charlib-edit-portrait-img {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 0.625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.charlib-altg {
  margin-top: 0.125rem;
}

.charlib-altg__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.375rem 0.5rem;
  margin-bottom: 0.125rem;
}

.charlib-altg__label {
  font-weight: 500;
}

.charlib-altg__chip {
  font-variant-numeric: tabular-nums;
}

.charlib-altg__scroll {
  max-height: min(38vh, 22rem);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 0.125rem;
}

.charlib-altg__panel {
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 0.5rem !important;
  margin-bottom: 0.5rem;
  overflow: hidden;
}

.charlib-altg__panel:last-child {
  margin-bottom: 0;
}

.charlib-altg__panel-title {
  column-gap: 0.5rem;
}

.charlib-altg__panel-idx {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgb(var(--v-theme-secondary));
  flex-shrink: 0;
}

.charlib-altg__panel-preview {
  font-size: 0.75rem;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  flex: 1;
  min-width: 0;
}

.charlib-altg__panel-body {
  padding-top: 0.25rem;
}
</style>
