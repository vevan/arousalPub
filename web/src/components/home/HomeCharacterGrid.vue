<script setup lang="ts">
import { characterImageUrl } from '@/utils/authenticated-media-url'
import { useAuthStore } from '@/stores/auth'
import type { HomeCharacterSource } from '@/utils/home-preferences'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  characterSource: HomeCharacterSource
  searchQuery: string
}>()

const emit = defineEmits<{
  pick: [payload: { id: string; name: string }]
}>()

const { t } = useI18n()
const auth = useAuthStore()

type CharacterFilter = 'all' | 'used' | 'unused'

interface CharacterListItem {
  id: string
  name: string
  summary: string
  tags: string[]
  usedInConversationCount: number
}

interface ListResponse {
  items: CharacterListItem[]
  total: number
  filterCounts?: { all: number; used: number; unused: number }
  hasMore: boolean
}

const PAGE = 24

const items = ref<CharacterListItem[]>([])
const total = ref(0)
const filterCounts = ref({ all: 0, used: 0, unused: 0 })
const filter = ref<CharacterFilter>('all')
const hasMore = ref(true)
const loading = ref(false)
const loadingMore = ref(false)
const errorText = ref('')
const searchDebounced = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const listScrollRef = ref<HTMLElement | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

function defaultFilterForSource(source: HomeCharacterSource): CharacterFilter {
  return source === 'usedInChats' ? 'used' : 'all'
}

function applySourceDefaults() {
  filter.value = defaultFilterForSource(props.characterSource)
}

watch(
  () => props.searchQuery,
  (s) => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      searchDebounced.value = s.trim()
      searchTimer = null
    }, 280)
  },
  { immediate: true },
)

watch(
  () => props.characterSource,
  () => {
    applySourceDefaults()
  },
  { immediate: true },
)

watch([filter, searchDebounced], () => {
  void reloadFromStart()
}, { immediate: true })

function buildQuery(offset: number) {
  const u = new URL('/api/characters', window.location.origin)
  u.searchParams.set('offset', String(offset))
  u.searchParams.set('limit', String(PAGE))
  if (searchDebounced.value) u.searchParams.set('search', searchDebounced.value)
  if (filter.value !== 'all') u.searchParams.set('filter', filter.value)
  u.searchParams.set('sort', 'name')
  u.searchParams.set('order', 'asc')
  return u.pathname + u.search
}

async function fetchSlice(offset: number, append: boolean) {
  const isFirst = offset === 0
  if (isFirst) loading.value = true
  else loadingMore.value = true
  errorText.value = ''
  try {
    const res = await fetch(buildQuery(offset))
    if (!res.ok) {
      errorText.value = t('home.charactersLoadFailed')
      return
    }
    const data = (await res.json()) as ListResponse
    total.value = data.total
    if (data.filterCounts) {
      filterCounts.value = data.filterCounts
    }
    hasMore.value = data.hasMore
    if (append) items.value = items.value.concat(data.items)
    else items.value = data.items
  } catch {
    errorText.value = t('home.charactersLoadFailed')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function reloadFromStart() {
  items.value = []
  total.value = 0
  hasMore.value = true
  await fetchSlice(0, false)
  await setupObserverAfterReload()
}

async function setupObserverAfterReload() {
  await nextTick()
  setupObserver()
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return
  await fetchSlice(items.value.length, true)
}

function setupObserver() {
  io?.disconnect()
  io = null
  const root = listScrollRef.value
  const el = sentinelRef.value
  if (!root || !el) return
  try {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (
            e.isIntersecting &&
            hasMore.value &&
            !loading.value &&
            !loadingMore.value
          ) {
            void loadMore()
          }
        }
      },
      { root, rootMargin: '80px', threshold: 0 },
    )
    io.observe(el)
  } catch {
    /* ignore */
  }
}

function characterImage(id: string) {
  return (
    characterImageUrl(auth.user?.id ?? auth.defaultUserId, id, { size: 'm' }) ??
    ''
  )
}

function onPick(item: CharacterListItem) {
  emit('pick', { id: item.id, name: item.name })
}

function setFilter(f: CharacterFilter) {
  filter.value = f
}

const sourceHint = computed(() =>
  props.characterSource === 'usedInChats'
    ? t('home.characterSourceUsedHint')
    : t('home.characterSourceAllHint'),
)

onUnmounted(() => {
  io?.disconnect()
  io = null
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div class="home-char flex-grow-1 d-flex flex-column min-height-0">
    <div
      class="home-char-filters"
      :aria-label="$t('characters.filterTitle')"
    >
      <button
        type="button"
        class="home-char-filter"
        :class="{ 'is-on': filter === 'all' }"
        @click="setFilter('all')"
      >
        {{ $t('characters.filterAll') }} · {{ filterCounts.all }}
      </button>
      <button
        type="button"
        class="home-char-filter"
        :class="{ 'is-on': filter === 'used' }"
        @click="setFilter('used')"
      >
        {{ $t('characters.filterUsed') }} · {{ filterCounts.used }}
      </button>
      <button
        type="button"
        class="home-char-filter"
        :class="{ 'is-on': filter === 'unused' }"
        @click="setFilter('unused')"
      >
        {{ $t('characters.filterUnused') }} · {{ filterCounts.unused }}
      </button>
    </div>

    <v-alert
      v-if="errorText"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3 mx-2"
      closable
      @click:close="errorText = ''"
    >
      {{ errorText }}
    </v-alert>

    <div
      v-if="loading && items.length === 0"
      class="text-body-2 text-medium-emphasis pa-4"
    >
      {{ $t('home.charactersLoading') }}
    </div>

    <div
      v-else
      ref="listScrollRef"
      class="home-char-scroll scroll-y-nice flex-grow-1 min-height-0"
    >
      <p
        v-if="items.length > 0"
        class="home-char-meta text-caption text-medium-emphasis px-2 mb-2"
      >
        {{ $t('home.charactersLoaded', { n: items.length, total }) }}
        · {{ sourceHint }}
      </p>

      <div
        v-if="items.length === 0"
        class="text-body-2 text-medium-emphasis pa-4"
      >
        {{ $t('home.charactersEmpty') }}
      </div>

      <div
        v-else
        class="home-char-grid px-2 pb-3"
      >
        <article
          v-for="p in items"
          :key="p.id"
          class="home-char-card"
          tabindex="0"
          @click="onPick(p)"
          @keydown.enter="onPick(p)"
        >
          <div class="home-char-card__visual">
            <img
              class="home-char-card__img"
              :src="characterImage(p.id)"
              alt=""
              loading="lazy"
            />
            <span
              class="home-char-card__badge"
              :class="{ 'is-muted': p.usedInConversationCount === 0 }"
            >
              {{
                p.usedInConversationCount > 0
                  ? $t('characters.badgeUsed')
                  : $t('characters.badgeUnused')
              }}
            </span>
          </div>
          <div class="home-char-card__body">
            <h3 class="home-char-card__name">
              {{ p.name }}
            </h3>
            <p class="home-char-card__desc">
              {{ p.summary }}
            </p>
            <div v-if="p.tags.length" class="home-char-card__tags">
              <span
                v-for="tg in p.tags.slice(0, 4)"
                :key="tg"
                class="home-char-chip"
              >{{ tg }}</span>
            </div>
          </div>
        </article>
      </div>
      <div
        v-if="items.length > 0"
        ref="sentinelRef"
        class="text-caption text-medium-emphasis pa-2"
      >
        {{ loadingMore ? '…' : '' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-char-filters {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin: 0 0.25rem 0.625rem;
}

.home-char-filter {
  padding: 0.375rem 0.625rem;
  border-radius: 0.375rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s,
    color 0.15s;
}

.home-char-filter:hover {
  color: rgb(var(--v-theme-on-surface));
  border-color: rgba(var(--v-theme-secondary), 0.35);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.home-char-filter.is-on {
  color: rgb(var(--v-theme-on-surface));
  border-color: rgba(var(--v-theme-secondary), 0.5);
  background: rgba(var(--v-theme-secondary), 0.12);
  box-shadow: inset 0 0 0 0.0625rem rgba(var(--v-theme-secondary), 0.25);
}

.home-char-scroll {
  overflow-y: auto;
}

.home-char-meta {
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
}

.home-char-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
  gap: 0.625rem;
}

.home-char-card {
  border-radius: 0.5rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.1);
  background: rgb(var(--v-theme-surface-light));
  overflow: hidden;
  cursor: pointer;
  outline: none;
  transition:
    border-color 0.15s,
    transform 0.15s;
}

.home-char-card:hover,
.home-char-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.4);
  transform: translateY(-0.0625rem);
}

.home-char-card__visual {
  aspect-ratio: 5 / 4;
  background: linear-gradient(165deg, #2a2622, #181614);
  position: relative;
  overflow: hidden;
}

.home-char-card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.home-char-card__badge {
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

.home-char-card__badge.is-muted {
  background: rgba(var(--v-theme-on-surface), 0.35);
}

.home-char-card__body {
  padding: 0.5rem 0.625rem 0.625rem;
}

.home-char-card__name {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-char-card__desc {
  margin: 0.25rem 0 0;
  font-size: 0.6875rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.home-char-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.375rem;
}

.home-char-chip {
  font-size: 0.5625rem;
  padding: 0.125rem 0.3125rem;
  border-radius: 0.1875rem;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.65);
}
</style>
