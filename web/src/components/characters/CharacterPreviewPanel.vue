<script setup lang="ts">
import type { CharacterDoc, CharacterListItem } from '@/composables/characters/types'

defineProps<{
  itemsLength: number
  loading: boolean
  selectedId: string | null
  selected: CharacterListItem | null
  detail: CharacterDoc | null
  systemPromptBlock: string
  previewUserMarkSaving: boolean
  exportDoing: boolean
  portraitSrc: string
  formatTime: (iso: string) => string
}>()

const emit = defineEmits<{
  edit: []
  'open-image-files': []
  'export-png': []
  'export-json': []
  delete: []
  'save-user-mark': [value: boolean | null]
}>()
</script>

<template>
  <section
    v-if="itemsLength > 0"
    class="charlib-preview"
  >
    <div class="charlib-preview__portrait">
      <img
        v-if="selectedId"
        class="charlib-preview__img"
        :src="portraitSrc"
        alt=""
      />
      <span
        v-else
        class="text-caption text-medium-emphasis"
      >{{ $t('characters.portraitPlaceholder') }}</span>
    </div>
    <div class="charlib-preview__main">
      <template v-if="selected">
        <div class="charlib-preview__head">
          <div class="charlib-preview__title-row">
            <h2 class="charlib-preview__name">
              {{ selected.name }}
            </h2>
            <v-tooltip location="bottom" :text="$t('characters.fieldIsUserHint')">
              <template #activator="{ props: tipProps }">
                <v-switch
                  v-bind="tipProps"
                  :model-value="detail?.isUser === true"
                  :label="$t('characters.fieldIsUser')"
                  :disabled="!detail || previewUserMarkSaving"
                  :loading="previewUserMarkSaving"
                  density="compact"
                  hide-details
                  color="primary"
                  class="charlib-preview__user-mark"
                  @update:model-value="emit('save-user-mark', $event)"
                />
              </template>
            </v-tooltip>
          </div>
          <div class="charlib-preview__actions">
            <v-btn variant="outlined" size="small" :disabled="!detail" @click="emit('edit')">
              {{ $t('characters.edit') }}
            </v-btn>
            <v-btn
              variant="outlined"
              size="small"
              :disabled="!selectedId"
              @click="emit('open-image-files')"
            >
              {{ $t('characters.imageFilesTitle') }}
            </v-btn>
            <v-btn variant="outlined" size="small" :disabled="!detail || exportDoing" @click="emit('export-png')">
              {{ $t('characters.exportPng') }}
            </v-btn>
            <v-btn variant="outlined" size="small" :disabled="!detail || exportDoing" @click="emit('export-json')">
              {{ $t('characters.exportJson') }}
            </v-btn>
            <v-btn variant="outlined" size="small" color="error" @click="emit('delete')">
              {{ $t('characters.delete') }}
            </v-btn>
          </div>
        </div>
        <p class="charlib-preview__meta text-caption text-medium-emphasis">
          {{
            $t('characters.previewSubtitle', {
              specs: $t('characters.specs', {
                imported: formatTime(detail?.importedAt ?? selected.updatedAt),
              }),
              usage: selected.usedInConversationCount > 0
                ? $t('characters.usageUsed')
                : $t('characters.usageUnused'),
            })
          }}
        </p>
        <p class="charlib-preview__summary text-body-2 text-medium-emphasis">
          {{ selected.summary }}
        </p>
        <div class="charlib-preview__block">
          <h3 class="charlib-preview__block-title">
            {{ $t('characters.systemPreviewHeading') }}
          </h3>
          <pre class="charlib-preview__mono">{{ systemPromptBlock || '—' }}</pre>
        </div>
      </template>
      <p
        v-else
        class="charlib-preview__intro text-body-2 text-medium-emphasis"
      >
        {{ $t('characters.previewNoSelection') }}
      </p>
    </div>
  </section>
  <section
    v-else-if="itemsLength === 0 && !loading"
    class="charlib-preview charlib-preview--empty text-medium-emphasis text-body-2"
  >
    {{ $t('characters.emptyHint') }}
  </section>
</template>

<style scoped>
.charlib-preview {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: 0.875rem 1.125rem;
  align-items: start;
  padding: 0.875rem 1rem;
  margin-bottom: 0.75rem;
  border-radius: 0.625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.charlib-preview--empty {
  display: flex;
  align-items: center;
  min-height: 4.5rem;
}

@media (max-width: 40rem) {
  .charlib-preview {
    grid-template-columns: 3.25rem 1fr;
    gap: 0.5rem 0.625rem;
    padding: 0.5rem 0.625rem;
    margin-bottom: 0.5rem;
  }
}

.charlib-preview__portrait {
  width: 100%;
  aspect-ratio: 3 / 4;
  max-height: 7.375rem;
  border-radius: 0.5rem;
  border: 0.0625rem dashed rgba(var(--v-theme-on-surface), 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0.375rem;
  overflow: hidden;
}

.charlib-preview__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 0.375rem;
  display: block;
}

.charlib-preview__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.25rem;
}

.charlib-preview__title-row {
  display: flex;
  align-items: center;
  gap: 0.625rem 1rem;
  flex-wrap: wrap;
  min-width: 0;
  flex: 1 1 12rem;
}

.charlib-preview__user-mark {
  flex: 0 0 auto;
}

.charlib-preview__user-mark :deep(.v-label) {
  font-size: 0.8125rem;
  opacity: 0.85;
}

.charlib-preview__name {
  margin: 0;
  font-family: 'Newsreader', Georgia, serif;
  font-size: 1.2rem;
  font-style: italic;
  min-width: 0;
}

.charlib-preview__intro {
  margin: 0;
  max-width: 62ch;
  text-wrap: pretty;
}

.charlib-preview__meta {
  margin: 0 0 0.5rem;
}

.charlib-preview__summary {
  margin: 0;
}

.charlib-preview__block {
  margin-top: 0.625rem;
  padding-top: 0.625rem;
  border-top: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.08);
}

.charlib-preview__block-title {
  margin: 0 0 0.25rem;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-secondary));
}

.charlib-preview__mono {
  margin: 0;
  font-family: ui-monospace, monospace;
  font-size: 0.6875rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 9em;
  overflow: hidden;
}

.charlib-preview__actions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}
</style>
