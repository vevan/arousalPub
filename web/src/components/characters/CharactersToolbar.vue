<script setup lang="ts">
import {
  CHARACTER_SORT_OPTIONS,
  type CharacterSort,
  type CharacterSortOrder,
} from '@/composables/characters/types'
import { mergeProps } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps<{
  sort: CharacterSort
  sortOrder: CharacterSortOrder
  sortLabel: string
  sortLabelTruncated: boolean
  search: string
  bindSortLabel: (el: Element | null) => void
  bindFileInput: (el: Element | null) => void
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:sort': [value: CharacterSort]
  'update:sortOrder': [value: CharacterSortOrder]
  import: [ev: Event]
  create: []
  'trigger-import': []
}>()

const { t } = useI18n()

function sortOptionLabel(opt: CharacterSort): string {
  const keys: Record<CharacterSort, string> = {
    recentChat: 'characters.sortRecentChat',
    recentUpdate: 'characters.sortRecent',
    name: 'characters.sortName',
    usageCount: 'characters.sortUsageCount',
  }
  return t(keys[opt])
}
</script>

<template>
  <div class="charlib-toolbar">
    <div class="charlib-sort-group">
      <v-menu location="bottom start">
        <template #activator="{ props: menuProps }">
          <v-tooltip
            location="top"
            :text="sortLabel"
            :disabled="!sortLabelTruncated"
          >
            <template #activator="{ props: tipProps }">
              <v-btn
                variant="outlined"
                size="small"
                class="charlib-sort-select"
                v-bind="mergeProps(menuProps, tipProps)"
              >
                <span
                  :ref="(el) => bindSortLabel(el as Element | null)"
                  class="charlib-sort-select__label"
                >{{ sortLabel }}</span>
                <v-icon
                  class="charlib-sort-select__caret"
                  size="16"
                >
                  mdi-chevron-down
                </v-icon>
              </v-btn>
            </template>
          </v-tooltip>
        </template>
        <v-list density="compact" min-width="11rem">
          <v-list-item
            v-for="opt in CHARACTER_SORT_OPTIONS"
            :key="opt"
            :active="sort === opt"
            @click="emit('update:sort', opt)"
          >
            <v-list-item-title>{{ sortOptionLabel(opt) }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-btn-toggle
        :model-value="sortOrder"
        mandatory
        divided
        density="compact"
        variant="outlined"
        class="charlib-sort-order"
        @update:model-value="emit('update:sortOrder', $event as CharacterSortOrder)"
      >
        <v-btn value="asc" size="small">
          {{ $t('characters.sortAsc') }}
        </v-btn>
        <v-btn value="desc" size="small">
          {{ $t('characters.sortDesc') }}
        </v-btn>
      </v-btn-toggle>
    </div>
    <div class="charlib-toolbar__row">
      <label class="charlib-search">
        <v-icon size="16" class="charlib-search__icon">mdi-magnify</v-icon>
        <input
          :value="search"
          type="search"
          class="charlib-search__input"
          :placeholder="$t('characters.searchPlaceholder')"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <input
        :ref="(el) => bindFileInput(el as Element | null)"
        type="file"
        accept="application/json,.json,image/png,.png"
        class="d-none"
        @change="emit('import', $event)"
      />
      <v-btn
        variant="tonal"
        size="small"
        class="charlib-toolbar__btn"
        @click="emit('create')"
      >
        {{ $t('characters.toolbarNew') }}
      </v-btn>
      <v-btn
        color="primary"
        size="small"
        class="charlib-toolbar__btn"
        @click="emit('trigger-import')"
      >
        {{ $t('characters.toolbarImport') }}
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.charlib-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  align-items: stretch;
  margin-bottom: 0.75rem;
}

.charlib-toolbar__row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.charlib-toolbar__btn {
  flex: 0 0 auto;
  white-space: nowrap;
}

.charlib-sort-group {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  flex-wrap: wrap;
}

/* 固定宽度按 en 最长项 "Recently updated" + 下拉箭头 */
.charlib-sort-select {
  width: 11.75rem;
  max-width: 11.75rem;
  min-width: 11.75rem !important;
  padding-inline: 0.625rem 0.375rem !important;
  text-transform: none;
  letter-spacing: normal;
}

.charlib-sort-select :deep(.v-btn__content) {
  width: 100%;
  justify-content: space-between;
  gap: 0.25rem;
  min-width: 0;
}

.charlib-sort-select__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
  text-align: start;
}

.charlib-sort-select__caret {
  flex-shrink: 0;
}

.charlib-sort-order :deep(.v-btn) {
  min-width: 3.25rem;
  letter-spacing: 0.02em;
}

.charlib-search {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.25rem;
  padding: 0 0.75rem;
  border-radius: 0.5rem;
  border: 0.0625rem solid rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.04);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.charlib-search:focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 0.125rem rgba(var(--v-theme-primary), 0.12);
}

.charlib-search__icon {
  color: rgb(var(--v-theme-primary));
  opacity: 0.85;
}

.charlib-search__input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  min-width: 0;
}
</style>
