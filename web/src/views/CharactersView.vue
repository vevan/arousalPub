<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  { embedded: false },
)

const { t } = useI18n()

interface CharacterListItem {
  id: string
  name: string
  summary: string
  systemPromptPreview: string
  tags: string[]
  updatedAt: string
  usedInConversationCount: number
}

interface CharacterDoc {
  schemaVersion: 1
  id: string
  importedAt: string
  updatedAt: string
  card: Record<string, unknown>
}

interface ListResponse {
  items: CharacterListItem[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

const PAGE = 24

const items = ref<CharacterListItem[]>([])
const total = ref(0)
const hasMore = ref(true)
const loading = ref(false)
const loadingMore = ref(false)
const errorText = ref('')
const filter = ref<'all' | 'used' | 'unused'>('all')
const search = ref('')
const searchDebounced = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const selectedId = ref<string | null>(null)
const detail = ref<CharacterDoc | null>(null)
const detailLoading = ref(false)

const deleteOpen = ref(false)
const deleteDoing = ref(false)

type CharFormMode = 'create' | 'edit'
const charFormOpen = ref(false)
const charFormMode = ref<CharFormMode>('create')
const charFormDoing = ref(false)
const charFormName = ref('')
const charFormDesc = ref('')
const charFormPersonality = ref('')
const charFormScenario = ref('')
const charFormFirstMes = ref('')
const charFormMesExample = ref('')
const charFormCreatorNotes = ref('')
const charFormCreator = ref('')
type AltGreetRow = { id: string; text: string }

function altGreetRowId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `ag-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const charFormAlternateGreetings = ref<AltGreetRow[]>([
  { id: altGreetRowId(), text: '' },
])
/** 折叠面板（multiple）：已展开项的 id */
const altGreetingPanelOpen = ref<string[]>([])
const charFormTags = ref('')
const charFormSystem = ref('')
const charFormPost = ref('')
const charFormNameError = ref('')
const charFormDialogError = ref('')
const snackOpen = ref(false)
const snackMessage = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)
const portraitInputRef = ref<HTMLInputElement | null>(null)
const charPortraitFile = ref<File | null>(null)
const charPortraitObjectUrl = ref('')
const portraitTick = ref(0)
const listScrollRef = ref<HTMLElement | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

const selected = computed(() =>
  items.value.find((x) => x.id === selectedId.value) ?? null,
)

function bumpPortraitTick() {
  portraitTick.value++
}

function characterImageSrc(id: string) {
  return `/api/characters/${id}/image?v=${portraitTick.value}`
}

const editPortraitSrc = computed(() => {
  if (charPortraitObjectUrl.value) return charPortraitObjectUrl.value
  if (charFormMode.value === 'edit' && selectedId.value) {
    return characterImageSrc(selectedId.value)
  }
  return ''
})

const systemPromptBlock = computed(() => {
  const sp = detail.value?.card?.system_prompt
  if (typeof sp === 'string' && sp.trim()) {
    const s = sp.trim()
    return s.length > 1200 ? `${s.slice(0, 1200)}…` : s
  }
  const prev = selected.value?.systemPromptPreview
  if (prev) return prev
  return ''
})

const charFormTitle = computed(() =>
  charFormMode.value === 'create'
    ? t('characters.createDialogTitle')
    : t('characters.editDialogTitle'),
)

const charFormHint = computed(() =>
  charFormMode.value === 'create'
    ? t('characters.createDialogHint')
    : t('characters.editDialogHint'),
)

const charFormSaveLabel = computed(() =>
  charFormMode.value === 'create'
    ? t('characters.createSave')
    : t('characters.editSave'),
)

watch(search, (s) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchDebounced.value = s.trim()
    searchTimer = null
  }, 280)
})

watch([filter, searchDebounced], () => {
  void reloadFromStart()
})

watch(selectedId, (id) => {
  if (!id) {
    detail.value = null
    return
  }
  void loadDetail(id)
})

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function buildQuery(offset: number) {
  const u = new URL('/api/characters', window.location.origin)
  u.searchParams.set('offset', String(offset))
  u.searchParams.set('limit', String(PAGE))
  if (searchDebounced.value) u.searchParams.set('search', searchDebounced.value)
  if (filter.value !== 'all') u.searchParams.set('filter', filter.value)
  return u.pathname + u.search
}

async function fetchSlice(offset: number, append: boolean) {
  const isFirst = offset === 0
  if (isFirst) {
    loading.value = true
  } else {
    loadingMore.value = true
  }
  errorText.value = ''
  try {
    const res = await fetch(buildQuery(offset))
    if (!res.ok) {
      errorText.value = t('characters.loadFailed')
      return
    }
    const data = (await res.json()) as ListResponse
    total.value = data.total
    hasMore.value = data.hasMore
    if (append) {
      items.value = items.value.concat(data.items)
    } else {
      items.value = data.items
    }
    if (
      selectedId.value &&
      !items.value.some((x) => x.id === selectedId.value)
    ) {
      selectedId.value = null
    }
  } catch {
    errorText.value = t('characters.loadFailed')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function reloadFromStart() {
  items.value = []
  total.value = 0
  hasMore.value = true
  selectedId.value = null
  detail.value = null
  await fetchSlice(0, false)
  await nextTick()
  setupObserver()
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return
  await fetchSlice(items.value.length, true)
}

async function loadDetail(id: string) {
  detailLoading.value = true
  try {
    const res = await fetch(`/api/characters/${id}`)
    if (!res.ok) {
      detail.value = null
      return
    }
    detail.value = (await res.json()) as CharacterDoc
  } catch {
    detail.value = null
  } finally {
    detailLoading.value = false
  }
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
      /* rootMargin 仅允许 px 或 %，不能用 rem（会抛错） */
      { root, rootMargin: '80px', threshold: 0 },
    )
    io.observe(el)
  } catch {
    /* 构造失败时降级为无无限滚动观察 */
  }
}

function selectCard(id: string) {
  selectedId.value = id
}

function setFilter(f: 'all' | 'used' | 'unused') {
  filter.value = f
}

function triggerImport() {
  fileInputRef.value?.click()
}

function resetCharForm() {
  charFormName.value = ''
  charFormDesc.value = ''
  charFormPersonality.value = ''
  charFormScenario.value = ''
  charFormFirstMes.value = ''
  charFormMesExample.value = ''
  charFormCreatorNotes.value = ''
  charFormCreator.value = ''
  charFormAlternateGreetings.value = [{ id: altGreetRowId(), text: '' }]
  altGreetingPanelOpen.value = []
  charFormTags.value = ''
  charFormSystem.value = ''
  charFormPost.value = ''
  charFormNameError.value = ''
  charFormDialogError.value = ''
  clearPortraitPick()
}

function clearPortraitPick() {
  if (charPortraitObjectUrl.value) {
    URL.revokeObjectURL(charPortraitObjectUrl.value)
    charPortraitObjectUrl.value = ''
  }
  charPortraitFile.value = null
  if (portraitInputRef.value) portraitInputRef.value.value = ''
}

function triggerPortraitPick() {
  portraitInputRef.value?.click()
}

function onPortraitFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    clearPortraitPick()
    return
  }
  const okPng =
    file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
  if (!okPng) {
    charFormDialogError.value = t('characters.portraitPngOnly')
    input.value = ''
    return
  }
  if (charPortraitObjectUrl.value) {
    URL.revokeObjectURL(charPortraitObjectUrl.value)
  }
  charPortraitFile.value = file
  charPortraitObjectUrl.value = URL.createObjectURL(file)
  charFormDialogError.value = ''
}

function populateAlternateGreetingsFromCard(card: Record<string, unknown>) {
  const raw = card.alternate_greetings
  if (Array.isArray(raw) && raw.length > 0) {
    charFormAlternateGreetings.value = raw.map((x) => ({
      id: altGreetRowId(),
      text: String(x),
    }))
  } else {
    charFormAlternateGreetings.value = [{ id: altGreetRowId(), text: '' }]
  }
  altGreetingPanelOpen.value = []
}

function addAltGreeting() {
  const id = altGreetRowId()
  charFormAlternateGreetings.value.push({ id, text: '' })
  altGreetingPanelOpen.value = [...altGreetingPanelOpen.value, id]
}

function removeAltGreeting(rowId: string) {
  const rows = charFormAlternateGreetings.value
  if (rows.length <= 1) {
    const r = rows[0]
    if (r) r.text = ''
    return
  }
  const i = rows.findIndex((r) => r.id === rowId)
  if (i >= 0) rows.splice(i, 1)
  const keep = new Set(charFormAlternateGreetings.value.map((r) => r.id))
  altGreetingPanelOpen.value = altGreetingPanelOpen.value.filter((id) =>
    keep.has(id),
  )
}

function alternateGreetingsPayload(): string[] {
  return charFormAlternateGreetings.value
    .map((r) => r.text.trim())
    .filter(Boolean)
}

const altGreetingStats = computed(() => {
  const total = charFormAlternateGreetings.value.length
  const filled = charFormAlternateGreetings.value.filter((r) =>
    r.text.trim(),
  ).length
  return { total, filled }
})

function altGreetingPreview(text: string): string {
  const s = text.trim().replace(/\s+/g, ' ')
  if (!s.length) return '—'
  return s.length > 72 ? `${s.slice(0, 72)}…` : s
}

function populateCharFormFromCard(card: Record<string, unknown>) {
  charFormName.value =
    strFromCard(card, 'name').trim() || selected.value?.name?.trim() || ''
  charFormDesc.value = strFromCard(card, 'description')
  charFormPersonality.value = strFromCard(card, 'personality')
  charFormScenario.value = strFromCard(card, 'scenario')
  charFormFirstMes.value = strFromCard(card, 'first_mes')
  charFormMesExample.value = strFromCard(card, 'mes_example')
  charFormCreatorNotes.value = strFromCard(card, 'creator_notes')
  charFormCreator.value = strFromCard(card, 'creator')
  populateAlternateGreetingsFromCard(card)
  charFormTags.value = tagsFromCardToString(card)
  charFormSystem.value = strFromCard(card, 'system_prompt')
  charFormPost.value = strFromCard(card, 'post_history_instructions')
}

function openCharForm(mode: CharFormMode) {
  charFormMode.value = mode
  charFormDialogError.value = ''
  charFormNameError.value = ''
  if (mode === 'create') {
    resetCharForm()
  } else {
    clearPortraitPick()
    if (!detail.value?.card) return
    populateCharFormFromCard(detail.value.card)
  }
  charFormOpen.value = true
}

function cardPayloadFromForm(): Record<string, unknown> {
  return {
    name: charFormName.value.trim(),
    description: charFormDesc.value,
    personality: charFormPersonality.value,
    scenario: charFormScenario.value,
    first_mes: charFormFirstMes.value,
    mes_example: charFormMesExample.value,
    creator_notes: charFormCreatorNotes.value,
    system_prompt: charFormSystem.value,
    post_history_instructions: charFormPost.value,
    tags: charFormTags.value,
    creator: charFormCreator.value,
    alternate_greetings: alternateGreetingsPayload(),
  }
}

async function submitCharForm() {
  charFormNameError.value = ''
  const name = charFormName.value.trim()
  if (!name) {
    charFormNameError.value = t('characters.nameRequired')
    return
  }
  charFormDoing.value = true
  charFormDialogError.value = ''
  try {
    if (charFormMode.value === 'create') {
      const payload = {
        name,
        description: charFormDesc.value,
        personality: charFormPersonality.value,
        scenario: charFormScenario.value,
        system_prompt: charFormSystem.value,
        post_history_instructions: charFormPost.value,
        first_mes: charFormFirstMes.value,
        mes_example: charFormMesExample.value,
        creator_notes: charFormCreatorNotes.value,
        tags: charFormTags.value,
        creator: charFormCreator.value,
        alternate_greetings: alternateGreetingsPayload(),
      }
      let res: Response
      if (charPortraitFile.value) {
        const fd = new FormData()
        fd.append('payload', JSON.stringify(payload))
        fd.append('portrait', charPortraitFile.value)
        res = await fetch('/api/characters', { method: 'POST', body: fd })
      } else {
        res = await fetch('/api/characters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        charFormDialogError.value = j.error ?? t('characters.createFailed')
        return
      }
      charFormOpen.value = false
      snackMessage.value = t('characters.createOk')
      snackOpen.value = true
      bumpPortraitTick()
      clearPortraitPick()
      await reloadFromStart()
    } else {
      if (!selectedId.value) return
      const id = selectedId.value
      const res = await fetch(`/api/characters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: cardPayloadFromForm() }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        charFormDialogError.value = j.error ?? t('characters.editFailed')
        return
      }
      let docJson = (await res.json()) as CharacterDoc
      if (charPortraitFile.value) {
        const fd = new FormData()
        fd.append('portrait', charPortraitFile.value)
        const res2 = await fetch(`/api/characters/${id}/portrait`, {
          method: 'POST',
          body: fd,
        })
        if (!res2.ok) {
          const j = (await res2.json().catch(() => ({}))) as { error?: string }
          charFormDialogError.value = j.error ?? t('characters.editFailed')
          return
        }
        docJson = (await res2.json()) as CharacterDoc
      }
      detail.value = docJson
      charFormOpen.value = false
      snackMessage.value = t('characters.editOk')
      snackOpen.value = true
      bumpPortraitTick()
      clearPortraitPick()
      await refreshListKeepSelection()
    }
  } catch {
    charFormDialogError.value =
      charFormMode.value === 'create'
        ? t('characters.createFailed')
        : t('characters.editFailed')
  } finally {
    charFormDoing.value = false
  }
}

async function onImportFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const lower = file.name.toLowerCase()
  try {
    if (lower.endsWith('.png') || file.type === 'image/png') {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/characters/import-png', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        errorText.value = j.error ?? t('characters.importFailed')
        return
      }
      snackMessage.value = t('characters.importOk')
      snackOpen.value = true
      bumpPortraitTick()
      try {
        await reloadFromStart()
      } catch (reloadErr) {
        errorText.value =
          reloadErr instanceof Error && reloadErr.message
            ? `${t('characters.loadFailed')} (${reloadErr.message})`
            : t('characters.loadFailed')
      }
      return
    }
    const text = await file.text()
    const parsed = JSON.parse(text) as Record<string, unknown>
    const cardPayload =
      parsed.schemaVersion === 1 &&
      parsed.card &&
      typeof parsed.card === 'object'
        ? (parsed.card as Record<string, unknown>)
        : parsed
    const res = await fetch('/api/characters/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card: cardPayload }),
    })
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      errorText.value = j.error ?? t('characters.importFailed')
      return
    }
    snackMessage.value = t('characters.importOk')
    snackOpen.value = true
    bumpPortraitTick()
    try {
      await reloadFromStart()
    } catch (reloadErr) {
      errorText.value =
        reloadErr instanceof Error && reloadErr.message
          ? `${t('characters.loadFailed')} (${reloadErr.message})`
          : t('characters.loadFailed')
    }
  } catch (e) {
    errorText.value =
      e instanceof Error && e.message
        ? `${t('characters.importFailed')} (${e.message})`
        : t('characters.importFailed')
  }
}

function exportJson() {
  if (!detail.value) return
  const blob = new Blob([JSON.stringify(detail.value, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${detail.value.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function openDelete() {
  if (selected.value) deleteOpen.value = true
}

async function confirmDelete() {
  if (!selectedId.value) return
  deleteDoing.value = true
  try {
    const res = await fetch(`/api/characters/${selectedId.value}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      errorText.value = t('characters.deleteFailed')
      return
    }
    deleteOpen.value = false
    await reloadFromStart()
  } catch {
    errorText.value = t('characters.deleteFailed')
  } finally {
    deleteDoing.value = false
  }
}

function strFromCard(card: Record<string, unknown>, key: string): string {
  const v = card[key]
  return typeof v === 'string' ? v : ''
}

function tagsFromCardToString(card: Record<string, unknown>): string {
  const raw = card.tags
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join(', ')
  }
  if (typeof raw === 'string') return raw
  return ''
}

async function refreshListKeepSelection() {
  const id = selectedId.value
  await fetchSlice(0, false)
  if (id && items.value.some((x) => x.id === id)) {
    selectedId.value = id
  } else {
    selectedId.value = null
  }
  if (selectedId.value) await loadDetail(selectedId.value)
  else detail.value = null
  await nextTick()
  setupObserver()
}

onMounted(() => {
  void reloadFromStart()
})

onUnmounted(() => {
  io?.disconnect()
  io = null
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div
    class="charlib flex-grow-1 d-flex flex-column min-height-0"
    :class="{ 'charlib--embedded': embedded }"
  >
    <div
      class="charlib__inner"
      :class="embedded ? 'charlib__inner--embedded' : 'app-page-shell'"
    >
      <header class="library-page-head">
        <div class="library-page-head__row">
          <h1 class="library-page-head__title">
            {{ $t('characters.pageTitle') }}
          </h1>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ $t('characters.lede') }}
            </p>
          </div>
        </div>
      </header>

      <div class="charlib-toolbar">
        <label class="charlib-search">
          <v-icon size="16" class="charlib-search__icon">mdi-magnify</v-icon>
          <input
            v-model="search"
            type="search"
            class="charlib-search__input"
            :placeholder="$t('characters.searchPlaceholder')"
          />
        </label>
        <input
          ref="fileInputRef"
          type="file"
          accept="application/json,.json,image/png,.png"
          class="d-none"
          @change="onImportFile"
        />
        <v-btn variant="tonal" size="small" @click="openCharForm('create')">
          {{ $t('characters.newCharacter') }}
        </v-btn>
        <v-btn color="primary" size="small" @click="triggerImport">
          {{ $t('characters.import') }}
        </v-btn>
        <v-btn variant="outlined" size="small" disabled>
          {{ $t('characters.sortRecent') }}
        </v-btn>
      </div>

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

      <section
        v-if="items.length > 0"
        class="charlib-preview"
      >
        <div class="charlib-preview__portrait">
          <img
            v-if="selectedId"
            class="charlib-preview__img"
            :src="characterImageSrc(selectedId)"
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
              <h2 class="charlib-preview__name">
                {{ selected.name }}
              </h2>
              <div class="charlib-preview__actions">
                <v-btn variant="outlined" size="small" :disabled="!detail" @click="openCharForm('edit')">
                  {{ $t('characters.edit') }}
                </v-btn>
                <v-btn variant="outlined" size="small" :disabled="!detail" @click="exportJson">
                  {{ $t('characters.exportJson') }}
                </v-btn>
                <v-btn variant="outlined" size="small" color="error" @click="openDelete">
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
        v-else-if="items.length === 0 && !loading"
        class="charlib-preview charlib-preview--empty text-medium-emphasis text-body-2"
      >
        {{ $t('characters.emptyHint') }}
      </section>

      <div class="charlib-zone">
        <aside class="charlib-rail" :aria-label="$t('characters.filterTitle')">
          <h2 class="charlib-rail__title">
            {{ $t('characters.filterTitle') }}
          </h2>
          <button
            type="button"
            class="charlib-filter"
            :class="{ 'is-on': filter === 'all' }"
            @click="setFilter('all')"
          >
            {{ $t('characters.filterAll') }} · {{ total }}
          </button>
          <button
            type="button"
            class="charlib-filter"
            :class="{ 'is-on': filter === 'used' }"
            @click="setFilter('used')"
          >
            {{ $t('characters.filterUsed') }}
          </button>
          <button
            type="button"
            class="charlib-filter"
            :class="{ 'is-on': filter === 'unused' }"
            @click="setFilter('unused')"
          >
            {{ $t('characters.filterUnused') }}
          </button>
          <button type="button" class="charlib-filter" disabled>
            {{ $t('characters.filterTagFantasy') }}
          </button>
          <button type="button" class="charlib-filter" disabled>
            {{ $t('characters.filterTagAdult') }}
          </button>
        </aside>

        <div
          ref="listScrollRef"
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
              @click="selectCard(p.id)"
              @keydown.enter="selectCard(p.id)"
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

          <div ref="sentinelRef" class="charlib-sentinel text-caption text-medium-emphasis">
            {{ loadingMore ? '…' : '' }}
          </div>
        </div>
      </div>

      <footer class="charlib-foot text-caption text-medium-emphasis">
        {{ $t('characters.footerNote') }}
      </footer>
    </div>

    <v-dialog v-model="charFormOpen">
      <v-card class="charlib-edit-card">
        <v-card-title>{{ charFormTitle }}</v-card-title>
        <v-card-text class="charlib-edit-card__body">
          <p class="text-body-2 text-medium-emphasis mb-3">
            {{ charFormHint }}
          </p>
          <v-alert
            v-if="charFormDialogError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-3"
            closable
            @click:close="charFormDialogError = ''"
          >
            {{ charFormDialogError }}
          </v-alert>

          <div class="charlib-edit-grid">
            <div
              class="charlib-edit-col charlib-edit-col--left charlib-edit-col--scroll scroll-y-nice"
            >
              <div
                class="charlib-edit-portrait-block"
              >
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
                  ref="portraitInputRef"
                  type="file"
                  accept="image/png,.png"
                  class="d-none"
                  @change="onPortraitFile"
                />
                <v-btn
                  variant="tonal"
                  size="small"
                  class="mt-2"
                  @click="triggerPortraitPick"
                >
                  {{ $t('characters.portraitPick') }}
                </v-btn>
                <p class="text-caption text-medium-emphasis mt-1 mb-0">
                  {{ $t('characters.portraitPickHint') }}
                </p>
              </div>
              <v-text-field
                v-model="charFormName"
                :label="$t('characters.fieldName')"
                :error-messages="charFormNameError"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
              />
              <v-textarea
                v-model="charFormDesc"
                :label="$t('characters.fieldDescription')"
                variant="outlined"
                rows="4"
                auto-grow
                hide-details="auto"
              />
              <v-text-field
                v-model="charFormTags"
                :label="$t('characters.fieldTags')"
                :hint="$t('characters.fieldTagsHint')"
                variant="outlined"
                density="comfortable"
                persistent-hint
              />
              <v-text-field
                v-model="charFormCreator"
                :label="$t('characters.fieldCreator')"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
              />
            </div>
            <div
              class="charlib-edit-col charlib-edit-col--right charlib-edit-col--scroll scroll-y-nice"
            >
              <v-textarea
                v-model="charFormPersonality"
                :label="$t('characters.fieldPersonality')"
                variant="outlined"
                rows="5"
                auto-grow
                hide-details="auto"
              />
              <v-textarea
                v-model="charFormScenario"
                :label="$t('characters.fieldScenario')"
                variant="outlined"
                rows="4"
                auto-grow
                hide-details="auto"
              />
              <v-textarea
                v-model="charFormFirstMes"
                :label="$t('characters.fieldFirstMes')"
                variant="outlined"
                rows="3"
                auto-grow
                hide-details="auto"
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
                    @click="addAltGreeting"
                  >
                    {{ $t('characters.altGreetingAdd') }}
                  </v-btn>
                </div>
                <p class="text-caption text-medium-emphasis mb-2">
                  {{ $t('characters.fieldAlternateGreetingsHint') }}
                </p>
                <div class="charlib-altg__scroll scroll-y-nice">
                  <v-expansion-panels
                    v-model="altGreetingPanelOpen"
                    multiple
                    variant="accordion"
                  >
                    <v-expansion-panel
                      v-for="(row, idx) in charFormAlternateGreetings"
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
                            @click="removeAltGreeting(row.id)"
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
                v-model="charFormMesExample"
                :label="$t('characters.fieldMesExample')"
                variant="outlined"
                rows="4"
                auto-grow
                hide-details="auto"
              />
              <v-textarea
                v-model="charFormCreatorNotes"
                :label="$t('characters.fieldCreatorNotes')"
                variant="outlined"
                rows="3"
                auto-grow
                hide-details="auto"
              />
              <v-textarea
                v-model="charFormSystem"
                :label="$t('characters.fieldSystem')"
                variant="outlined"
                rows="5"
                auto-grow
                hide-details="auto"
              />
              <v-textarea
                v-model="charFormPost"
                :label="$t('characters.fieldPostHistory')"
                variant="outlined"
                rows="4"
                auto-grow
                hide-details="auto"
              />
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="charFormDoing" @click="charFormOpen = false">
            {{ $t('characters.cancel') }}
          </v-btn>
          <v-btn color="primary" :loading="charFormDoing" @click="submitCharForm">
            {{ charFormSaveLabel }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteOpen">
      <v-card>
        <v-card-title>{{ $t('characters.deleteDialogTitle') }}</v-card-title>
        <v-card-text>
          {{ $t('characters.deleteDialogBody', { name: selected?.name ?? '' }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteOpen = false">
            {{ $t('characters.cancel') }}
          </v-btn>
          <v-btn color="error" :loading="deleteDoing" @click="confirmDelete">
            {{ $t('characters.delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackOpen" :timeout="3200" location="bottom">
      {{ snackMessage }}
      <template #actions>
        <v-btn variant="text" @click="snackOpen = false">OK</v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<style scoped>
.min-height-0 {
  min-height: 0;
}

.charlib {
  padding-block: 1rem 1.25rem;
  min-height: 0;
}

.charlib__inner {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.charlib--embedded {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
}
.charlib__inner--embedded {
  width: 100%;
  max-width: none;
  margin-inline: 0;
  padding-inline: 0;
  box-sizing: border-box;
}

.charlib-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.charlib-edit-card {
  width: 100%;
  max-width: 100%;
}

.charlib-edit-card__body {
  padding-top: 0.5rem;
  overflow: hidden;
}

.charlib-edit-grid {
  display: grid;
  grid-template-columns: minmax(8.25rem, 0.42fr) minmax(16.25rem, 1.58fr);
  gap: 1rem 1.375rem;
  align-items: start;
}

@media (max-width: 45rem) {
  .charlib-edit-grid {
    grid-template-columns: 1fr;
  }
}

.charlib-edit-col {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  min-width: 0;
}

.charlib-edit-col--right {
  padding-top: 0.5rem;
}

.charlib-edit-col--scroll {
  max-height: min(80vh, 52rem);
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  padding-right: 0.25rem;
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

.charlib-search {
  flex: 1 1 12.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.25rem;
  padding: 0 0.75rem;
  border-radius: 0.5rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.charlib-search__icon {
  opacity: 0.45;
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

@media (max-width: 45rem) {
  .charlib-preview {
    grid-template-columns: 4.5rem 1fr;
  }

  .charlib-preview__head {
    flex-direction: column;
    align-items: stretch;
  }

  .charlib-preview__actions {
    justify-content: flex-start;
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

.charlib-zone {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  gap: 0.875rem;
}

@media (max-width: 50rem) {
  .charlib-zone {
    flex-direction: column;
  }
  .charlib-rail {
    max-height: 12.5rem;
    flex: 0 1 auto;
    width: 100%;
  }
  .charlib-scroll {
    flex: 1 1 0%;
    min-height: 12.5rem;
  }
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

.scroll-y-nice {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(196, 92, 46, 0.45) rgba(12, 10, 8, 0.45);
}

.scroll-y-nice::-webkit-scrollbar {
  width: 0.5rem;
}
.scroll-y-nice::-webkit-scrollbar-track {
  background: rgba(12, 10, 8, 0.45);
  border-radius: 50%;
  margin-block: 0.25rem;
}
.scroll-y-nice::-webkit-scrollbar-thumb {
  background: rgba(196, 92, 46, 0.45);
  border-radius: 50%;
  border: 0.125rem solid transparent;
  background-clip: padding-box;
}

/* 编辑弹窗左右栏：覆盖 .scroll-y-nice 的 stable，未超高时不预留滚动条位；超高时才出现滚动条 */
.charlib-edit-col--scroll.scroll-y-nice {
  scrollbar-gutter: auto;
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

.charlib-foot {
  flex-shrink: 0;
  margin-top: 0.625rem;
  padding-top: 0.625rem;
  border-top: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.08);
}
</style>
