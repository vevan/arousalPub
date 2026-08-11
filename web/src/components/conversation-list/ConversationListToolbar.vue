<script setup lang="ts">
import type { HomeSortOrder } from '@/utils/home-preferences'

defineProps<{
  searchQuery: string
  searchPlaceholder: string
  sortLabel: string
  sortOrder: HomeSortOrder
  sortOptions: string[]
  activeSort: string
  sortOptionLabel: (opt: string) => string
  sortOrderOptions: HomeSortOrder[]
  sortOrderLabel: (order: HomeSortOrder) => string
  sortOrderIcon: (order: HomeSortOrder) => string
}>()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  'update:sort': [value: string]
  'update:sortOrder': [value: HomeSortOrder]
}>()
</script>

<template>
  <div class="list-toolbar">
    <label class="list-search">
      <v-icon size="16" class="list-search__icon">mdi-magnify</v-icon>
      <input
        :value="searchQuery"
        type="search"
        class="list-search__input"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder"
        @input="
          emit(
            'update:searchQuery',
            ($event.target as HTMLInputElement).value,
          )
        "
      />
      <button
        v-if="searchQuery.trim()"
        type="button"
        class="list-search__clear"
        :aria-label="$t('conversationList.searchClear')"
        @click="emit('update:searchQuery', '')"
      >
        <v-icon size="16">mdi-close</v-icon>
      </button>
    </label>
    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <button
          type="button"
          class="list-sort-btn"
          v-bind="menuProps"
          :aria-label="$t('home.sortButton')"
        >
          <v-icon size="16">{{ sortOrderIcon(sortOrder) }}</v-icon>
          <span class="list-sort-btn__label">{{ sortLabel }}</span>
          <v-icon size="14" class="list-sort-btn__caret">mdi-chevron-down</v-icon>
        </button>
      </template>
      <v-list density="compact" min-width="10rem">
        <v-list-item
          v-for="opt in sortOptions"
          :key="opt"
          :active="activeSort === opt"
          @click="emit('update:sort', opt)"
        >
          <v-list-item-title>{{ sortOptionLabel(opt) }}</v-list-item-title>
        </v-list-item>
        <v-divider class="my-1" />
        <v-list-item
          v-for="ord in sortOrderOptions"
          :key="ord"
          :active="sortOrder === ord"
          @click="emit('update:sortOrder', ord)"
        >
          <template #prepend>
            <v-icon size="18">{{ sortOrderIcon(ord) }}</v-icon>
          </template>
          <v-list-item-title>{{ sortOrderLabel(ord) }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>

<style scoped>
.list-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0.25rem 0.75rem;
}

.list-toolbar .list-search {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.list-sort-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 2.25rem;
  max-width: 9.5rem;
  padding: 0 0.625rem;
  border-radius: 0.5rem;
  border: 0.0625rem solid rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.list-sort-btn:hover,
.list-sort-btn[aria-expanded='true'] {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}

.list-sort-btn__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list-sort-btn__caret {
  flex-shrink: 0;
  opacity: 0.65;
}

.list-search {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.25rem;
  margin: 0 0.25rem 0.75rem;
  padding: 0 0.75rem;
  border-radius: 0.5rem;
  border: 0.0625rem solid rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.04);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.list-search:focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 0.125rem rgba(var(--v-theme-primary), 0.12);
}

.list-search__icon {
  flex-shrink: 0;
  color: rgb(var(--v-theme-primary));
  opacity: 0.85;
}

.list-search__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
}

.list-search__input::-webkit-search-cancel-button {
  display: none;
}

.list-search__clear {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
  border-radius: 0.25rem;
}

.list-search__clear:hover {
  color: rgb(var(--v-theme-on-surface));
}
</style>
