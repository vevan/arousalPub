<script setup lang="ts">
import type {
  CharacterKind,
  CharacterListItem,
  CharacterUsageFilter,
} from '@/composables/characters/types'

defineProps<{
  items: CharacterListItem[]
  total: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  selectedId: string | null
  kind: CharacterKind
  filter: CharacterUsageFilter
  filterCounts: {
    all: number
    used: number
    unused: number
    kindAll: number
    kindUser: number
    kindNotUser: number
  }
  characterImageSrc: (id: string) => string
  bindListScroll: (el: Element | null) => void
  bindSentinel: (el: Element | null) => void
}>()

const emit = defineEmits<{
  select: [id: string]
  'set-kind': [kind: CharacterKind]
  'set-filter': [filter: CharacterUsageFilter]
}>()
</script>

<template>
  <div class="charlib-zone">
    <aside class="charlib-rail" :aria-label="$t('characters.filterTitle')">
      <h2 class="charlib-rail__title">
        {{ $t('characters.filterKindTitle') }}
      </h2>
      <button
        type="button"
        class="charlib-filter"
        :class="{ 'is-on': kind === 'notUser' }"
        @click="emit('set-kind', 'notUser')"
      >
        {{ $t('characters.filterCharacter') }} · {{ filterCounts.kindNotUser }}
      </button>
      <button
        type="button"
        class="charlib-filter"
        :class="{ 'is-on': kind === 'user' }"
        @click="emit('set-kind', 'user')"
      >
        {{ $t('characters.filterUser') }} · {{ filterCounts.kindUser }}
      </button>
      <button
        type="button"
        class="charlib-filter"
        :class="{ 'is-on': kind === 'all' }"
        @click="emit('set-kind', 'all')"
      >
        {{ $t('characters.filterKindAll') }} · {{ filterCounts.kindAll }}
      </button>
      <h2 class="charlib-rail__title charlib-rail__title--sub">
        {{ $t('characters.filterUsageTitle') }}
      </h2>
      <button
        type="button"
        class="charlib-filter"
        :class="{ 'is-on': filter === 'all' }"
        @click="emit('set-filter', 'all')"
      >
        {{ $t('characters.filterAll') }} · {{ filterCounts.all }}
      </button>
      <button
        type="button"
        class="charlib-filter"
        :class="{ 'is-on': filter === 'used' }"
        @click="emit('set-filter', 'used')"
      >
        {{ $t('characters.filterUsed') }} · {{ filterCounts.used }}
      </button>
      <button
        type="button"
        class="charlib-filter"
        :class="{ 'is-on': filter === 'unused' }"
        @click="emit('set-filter', 'unused')"
      >
        {{ $t('characters.filterUnused') }} · {{ filterCounts.unused }}
      </button>
    </aside>

    <div
      :ref="(el) => bindListScroll(el as Element | null)"
      class="charlib-scroll scroll-y-nice"
      tabindex="0"
      role="region"
      :aria-label="$t('characters.listTitle')"
    >
      <div class="charlib-scroll__head">
        <div class="charlib-scroll__head-main">
          <strong class="charlib-scroll__head-title">{{ $t('characters.listTitle') }}</strong>
          <p class="charlib-scroll__hint">
            {{ $t('characters.listHint') }}
          </p>
        </div>
        <span class="charlib-scroll__meta text-caption">
          {{ $t('characters.listLoaded', { n: items.length, total }) }}
          · {{ hasMore ? $t('characters.scrollMore') : $t('characters.loadEnd') }}
        </span>
      </div>

      <div v-if="loading && items.length === 0" class="pa-4 text-medium-emphasis">
        {{ $t('characters.loading') }}
      </div>

      <div v-else-if="items.length === 0" class="charlib-empty">
        <div class="charlib-empty__title">
          {{ $t('characters.emptyTitle') }}
        </div>
        <div class="charlib-empty__hint">
          {{ $t('characters.emptyHint') }}
        </div>
      </div>

      <div v-else class="charlib-grid">
        <article
          v-for="p in items"
          :key="p.id"
          class="charlib-card"
          :class="{ 'is-active': selectedId === p.id }"
          tabindex="0"
          @click="emit('select', p.id)"
          @keydown.enter="emit('select', p.id)"
        >
          <div class="charlib-card__visual">
            <img
              class="charlib-card__img"
              :src="characterImageSrc(p.id)"
              alt=""
              loading="lazy"
            />
            <div class="charlib-card__ph">
              {{ $t('characters.portraitShort') }}
            </div>
            <span
              v-if="p.isUser"
              class="charlib-card__badge charlib-card__badge--user"
            >
              {{ $t('characters.badgeUser') }}
            </span>
            <span
              class="charlib-card__badge"
              :class="{ 'is-muted': p.usedInConversationCount === 0 }"
            >
              {{
                p.usedInConversationCount > 0
                  ? $t('characters.badgeUsed')
                  : $t('characters.badgeUnused')
              }}
            </span>
          </div>
          <div class="charlib-card__body">
            <h3 class="charlib-card__name">
              {{ p.name }}
            </h3>
            <p class="charlib-card__desc">
              {{ p.summary }}
            </p>
            <div v-if="p.tags.length" class="charlib-chips">
              <span v-for="tg in p.tags" :key="tg" class="charlib-chip">{{ tg }}</span>
            </div>
          </div>
        </article>
      </div>

      <div
        :ref="(el) => bindSentinel(el as Element | null)"
        class="charlib-sentinel text-caption text-medium-emphasis"
      >
        {{ loadingMore ? '…' : '' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.charlib-zone {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  gap: 0.875rem;
}

.charlib-rail {
  flex: 0 0 10.5rem;
  min-height: 0;
  padding: 0.75rem 0.625rem;
  border-radius: 0.625rem;
  border: 0.0625rem dashed rgba(var(--v-theme-secondary), 0.35);
  background: rgba(var(--v-theme-surface), 0.5);
  overflow-y: auto;
}

.charlib-rail__title {
  margin: 0 0 0.625rem;
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.charlib-rail__title--sub {
  margin-top: 0.875rem;
}

.charlib-filter {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4375rem 0.5rem;
  margin-bottom: 0.1875rem;
  border-radius: 0.375rem;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.charlib-filter:hover:not(:disabled) {
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.charlib-filter.is-on {
  color: rgb(var(--v-theme-on-surface));
  background: rgba(var(--v-theme-secondary), 0.15);
  box-shadow: inset 0 0 0 0.0625rem rgba(var(--v-theme-secondary), 0.35);
}

.charlib-scroll {
  flex: 1 1 0%;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0.125rem 0.25rem 0.5rem;
  border-radius: 0.625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgba(var(--v-theme-surface), 0.35);
}

.charlib-scroll__head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.625rem 1rem;
  padding: 0.625rem 0.5rem 0.75rem;
  margin: -0.125rem -0.25rem 0.625rem -0.125rem;
  background: linear-gradient(
    180deg,
    rgba(var(--v-theme-surface), 0.98) 55%,
    transparent
  );
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.08);
}

.charlib-scroll__head-main {
  flex: 1 1 12.5rem;
  min-width: 0;
}

.charlib-scroll__head-title {
  font-family: 'Newsreader', Georgia, serif;
  font-style: italic;
  font-size: 0.9375rem;
}

.charlib-scroll__hint {
  margin: 0.375rem 0 0;
  max-width: 62ch;
  font-size: 0.6875rem;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

.charlib-scroll__meta {
  flex-shrink: 0;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.charlib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
  gap: 0.625rem;
  padding: 0 0.375rem 0.75rem;
}

.charlib-card {
  border-radius: 0.5rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.charlib-card:hover,
.charlib-card:focus-visible {
  border-color: rgba(var(--v-theme-secondary), 0.45);
}

.charlib-card.is-active {
  border-color: rgba(var(--v-theme-secondary), 0.65);
  box-shadow: 0 0 0 0.0625rem rgba(var(--v-theme-secondary), 0.22);
}

.charlib-card__visual {
  aspect-ratio: 5 / 4;
  background: linear-gradient(165deg, #2a2622, #181614);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.charlib-card__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 1;
}

.charlib-card__ph {
  width: 70%;
  height: 58%;
  border-radius: 0.375rem;
  border: 0.0625rem dashed rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.5625rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.35);
  position: relative;
  z-index: 0;
}

.charlib-card__badge {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  font-size: 0.5rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0.125rem 0.3125rem;
  border-radius: 0.1875rem;
  background: rgba(196, 92, 46, 0.92);
  color: #fff;
}

.charlib-card__badge.is-muted {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.55);
}

.charlib-card__badge--user {
  left: 0.375rem;
  right: auto;
  background: rgba(72, 128, 168, 0.92);
}

.charlib-card__body {
  padding: 0.5rem 0.625rem 0.625rem;
}

.charlib-card__name {
  margin: 0 0 0.25rem;
  font-family: 'Newsreader', Georgia, serif;
  font-size: 0.95rem;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.charlib-card__desc {
  margin: 0;
  font-size: 0.6875rem;
  line-height: 1.35;
  color: rgba(var(--v-theme-on-surface), 0.55);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.charlib-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.375rem;
}

.charlib-chip {
  font-size: 0.5rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 0.125rem 0.3125rem;
  border-radius: 0.125rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.charlib-sentinel {
  height: 1.25rem;
  text-align: center;
  padding: 0.5rem;
}

.charlib-empty {
  padding: 1.75rem 1rem;
  text-align: center;
  border: 0.0625rem dashed rgba(var(--v-theme-on-surface), 0.15);
  border-radius: 0.5rem;
}

.charlib-empty__title {
  font-family: 'Newsreader', Georgia, serif;
  font-style: italic;
  font-size: 1rem;
}

.charlib-empty__hint {
  margin-top: 0.375rem;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
</style>
