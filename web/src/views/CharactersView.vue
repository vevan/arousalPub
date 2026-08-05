<script setup lang="ts">
import CharacterEditDialog from '@/components/characters/CharacterEditDialog.vue'
import CharacterListPanel from '@/components/characters/CharacterListPanel.vue'
import CharacterPreviewPanel from '@/components/characters/CharacterPreviewPanel.vue'
import CharactersDialogs from '@/components/characters/CharactersDialogs.vue'
import CharactersToolbar from '@/components/characters/CharactersToolbar.vue'
import '@/components/characters/characters-library.css'
import { useCharactersLibrary } from '@/composables/characters/useCharactersLibrary'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  { embedded: false },
)

const emit = defineEmits<{
  close: []
}>()

const {
  items,
  total,
  filterCounts,
  hasMore,
  loading,
  loadingMore,
  exportDoing,
  errorText,
  kind,
  filter,
  sort,
  sortOrder,
  search,
  selectedId,
  detail,
  selected,
  deleteOpen,
  deleteTargetLabel,
  deleteDoing,
  imageFilesOpen,
  charFormOpen,
  charFormDoing,
  charFormName,
  charFormDesc,
  charFormPersonality,
  charFormScenario,
  charFormFirstMes,
  charFormMesExample,
  charFormCreatorNotes,
  charFormCreator,
  charFormAlternateGreetings,
  altGreetingPanelOpen,
  charFormTags,
  charFormSystem,
  charFormPost,
  charFormNameError,
  previewUserMarkSaving,
  charFormDialogError,
  editPortraitSrc,
  systemPromptBlock,
  charFormTitle,
  charFormHint,
  charFormSaveLabel,
  sortLabel,
  sortLabelTruncated,
  altGreetingStats,
  characterImageSrc,
  formatTime,
  bindListScrollEl,
  bindSentinelEl,
  bindFileInputEl,
  bindPortraitInputEl,
  bindSortSelectLabelEl,
  bindImageFilesPanel,
  openImageFilesPicker,
  selectCard,
  setKind,
  setFilter,
  setSort,
  setSortOrder,
  triggerImport,
  triggerPortraitPick,
  onPortraitFile,
  addAltGreeting,
  removeAltGreeting,
  altGreetingPreview,
  openCharForm,
  savePreviewUserMark,
  submitCharForm,
  onImportFile,
  exportJson,
  exportPng,
  openDelete,
  confirmDelete,
  closeDelete,
} = useCharactersLibrary()
</script>

<template>
  <div
    class="charlib flex-grow-1 d-flex flex-column min-height-0"
    :class="{ 'charlib--embedded': props.embedded }"
  >
    <div
      class="charlib__inner"
      :class="props.embedded ? 'charlib__inner--embedded' : 'app-page-shell'"
    >
      <header
        class="library-page-head"
        :class="{ 'library-page-head--with-close': props.embedded }"
      >
        <div class="library-page-head__row">
          <h1 class="library-page-head__title">
            {{ $t('characters.pageTitle') }}
          </h1>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ $t('characters.lede') }}
            </p>
          </div>
          <button
            v-if="props.embedded"
            type="button"
            class="library-page-head__close"
            :aria-label="$t('settings.closeModal')"
            @click="emit('close')"
          >
            <v-icon size="20">mdi-close</v-icon>
          </button>
        </div>
      </header>

      <CharactersToolbar
        v-model:search="search"
        :sort="sort"
        :sort-order="sortOrder"
        :sort-label="sortLabel"
        :sort-label-truncated="sortLabelTruncated"
        :bind-sort-label="bindSortSelectLabelEl"
        :bind-file-input="bindFileInputEl"
        @update:sort="setSort"
        @update:sort-order="setSortOrder"
        @import="onImportFile"
        @create="openCharForm('create')"
        @trigger-import="triggerImport"
      />

      <v-alert
        v-if="errorText"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-3"
        closable
        @click:close="errorText = ''"
      >
        {{ errorText }}
      </v-alert>

      <CharacterPreviewPanel
        :items-length="items.length"
        :loading="loading"
        :selected-id="selectedId"
        :selected="selected"
        :detail="detail"
        :system-prompt-block="systemPromptBlock"
        :preview-user-mark-saving="previewUserMarkSaving"
        :export-doing="exportDoing"
        :portrait-src="selectedId ? characterImageSrc(selectedId) : ''"
        :format-time="formatTime"
        @edit="openCharForm('edit')"
        @open-image-files="imageFilesOpen = true"
        @export-png="exportPng"
        @export-json="exportJson"
        @delete="openDelete"
        @save-user-mark="savePreviewUserMark"
      />

      <CharacterListPanel
        :items="items"
        :total="total"
        :has-more="hasMore"
        :loading="loading"
        :loading-more="loadingMore"
        :selected-id="selectedId"
        :kind="kind"
        :filter="filter"
        :filter-counts="filterCounts"
        :character-image-src="characterImageSrc"
        :bind-list-scroll="bindListScrollEl"
        :bind-sentinel="bindSentinelEl"
        @select="selectCard"
        @set-kind="setKind"
        @set-filter="setFilter"
      />

      <footer class="charlib-foot text-caption text-medium-emphasis">
        {{ $t('characters.footerNote') }}
      </footer>
    </div>

    <CharacterEditDialog
      v-model:open="charFormOpen"
      v-model:dialog-error="charFormDialogError"
      v-model:name="charFormName"
      v-model:description="charFormDesc"
      v-model:tags="charFormTags"
      v-model:creator="charFormCreator"
      v-model:personality="charFormPersonality"
      v-model:scenario="charFormScenario"
      v-model:first-mes="charFormFirstMes"
      v-model:mes-example="charFormMesExample"
      v-model:creator-notes="charFormCreatorNotes"
      v-model:system="charFormSystem"
      v-model:post="charFormPost"
      v-model:alt-greeting-panel-open="altGreetingPanelOpen"
      :title="charFormTitle"
      :hint="charFormHint"
      :save-label="charFormSaveLabel"
      :doing="charFormDoing"
      :name-error="charFormNameError"
      :edit-portrait-src="editPortraitSrc"
      :alternate-greetings="charFormAlternateGreetings"
      :alt-greeting-stats="altGreetingStats"
      :alt-greeting-preview="altGreetingPreview"
      :bind-portrait-input="bindPortraitInputEl"
      @portrait-change="onPortraitFile"
      @trigger-portrait="triggerPortraitPick"
      @add-alt-greeting="addAltGreeting"
      @remove-alt-greeting="removeAltGreeting"
      @submit="submitCharForm"
    />

    <CharactersDialogs
      v-model:image-files-open="imageFilesOpen"
      v-model:delete-open="deleteOpen"
      :selected-id="selectedId"
      :delete-target-label="deleteTargetLabel"
      :delete-doing="deleteDoing"
      :bind-image-files-panel="bindImageFilesPanel"
      @close-delete="closeDelete"
      @confirm-delete="confirmDelete"
      @open-picker="openImageFilesPicker"
    />
  </div>
</template>
