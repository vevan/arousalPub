<script setup lang="ts">
import type { ComposerSlashCommandSpec } from '@/utils/composer-slash-catalog'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  open: boolean
  items: ComposerSlashCommandSpec[]
  activeIndex: number
}>()

const emit = defineEmits<{
  (e: 'pick', spec: ComposerSlashCommandSpec): void
  (e: 'hover', index: number): void
}>()

const { t, te } = useI18n()

const description = (spec: ComposerSlashCommandSpec) =>
  te(spec.descriptionKey) ? t(spec.descriptionKey) : spec.descriptionKey

const show = computed(() => props.open && props.items.length > 0)
</script>

<template>
  <Teleport to="#composer-slash-layer">
    <div
      v-show="show"
      class="composer-slash-menu"
      role="listbox"
      :aria-label="t('chat.slash.menuAria')"
    >
      <button
        v-for="(item, index) in items"
        :key="`${item.source}-${item.id}`"
        type="button"
        role="option"
        class="composer-slash-menu__item"
        :class="{ 'composer-slash-menu__item--active': index === activeIndex }"
        :aria-selected="index === activeIndex"
        @mousedown.prevent
        @click="emit('pick', item)"
        @mouseenter="emit('hover', index)"
      >
        <span class="composer-slash-menu__example">{{ item.example }}</span>
        <span class="composer-slash-menu__desc">{{ description(item) }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.composer-slash-menu {
  position: fixed;
  position-anchor: --composer-slash-anchor;
  left: anchor(left);
  bottom: anchor(top);
  width: anchor-size(width);
  translate: 0 -0.375rem;
  max-height: 60dvh;
  overflow-y: auto;
  overscroll-behavior: contain;
  z-index: 2400;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.375rem;
  border-radius: var(--radius, 0.5rem);
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface-bright));
  box-shadow:
    0 0.25rem 1rem rgba(0, 0, 0, 0.12),
    0 0 0 0.0625rem rgba(var(--v-theme-on-surface), 0.04);
}

.composer-slash-menu__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: none;
  border-radius: calc(var(--radius, 0.5rem) - 0.125rem);
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.composer-slash-menu__item--active,
.composer-slash-menu__item:hover {
  background: rgba(var(--v-theme-primary), 0.1);
}

.composer-slash-menu__example {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.875rem;
  line-height: 1.35;
  color: rgb(var(--v-theme-on-surface));
}

.composer-slash-menu__desc {
  font-size: 0.8125rem;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.62);
}
</style>
