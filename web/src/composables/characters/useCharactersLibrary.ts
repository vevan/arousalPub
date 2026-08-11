import { characterImageUrl } from '@/utils/authenticated-media-url'
import { coreNotify } from '@/utils/core-notify'
import { useAsyncAction } from '@/composables/useAsyncAction'
import { useDeleteConfirmDialog } from '@/composables/useDeleteConfirmDialog'
import { useAuthStore } from '@/stores/auth'
import { apiFetch } from '@/utils/api-fetch'
import { generateShortId } from '@/utils/short-id'
import {
  CHARACTER_LIST_PAGE,
  CHARACTER_SORT_OPTIONS,
  type AltGreetRow,
  type CharacterDoc,
  type CharacterKind,
  type CharacterListItem,
  type CharacterSort,
  type CharacterSortOrder,
  type CharacterUsageFilter,
  type CharFormMode,
  type ListResponse,
} from '@/composables/characters/types'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

export function useCharactersLibrary() {
  const { t, locale } = useI18n()
  const auth = useAuthStore()

  const items = ref<CharacterListItem[]>([])
  const total = ref(0)
  const filterCounts = ref({
    all: 0,
    used: 0,
    unused: 0,
    kindAll: 0,
    kindUser: 0,
    kindNotUser: 0,
  })
  const hasMore = ref(true)
  const loading = ref(false)
  const loadingMore = ref(false)
  const { loading: exportDoing, errorText, run: runExport } = useAsyncAction()
  const kind = ref<CharacterKind>('notUser')
  const filter = ref<CharacterUsageFilter>('all')
  const sort = ref<CharacterSort>('name')
  const sortOrder = ref<CharacterSortOrder>('asc')
  const search = ref('')
  const searchDebounced = ref('')
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const selectedId = ref<string | null>(null)
  const detail = ref<CharacterDoc | null>(null)
  const detailLoading = ref(false)

  const {
    open: deleteOpen,
    targetLabel: deleteTargetLabel,
    confirming: deleteDoing,
    askDelete,
    close: closeDelete,
    confirm: confirmDeleteAction,
  } = useDeleteConfirmDialog()
  const imageFilesOpen = ref(false)
  const imageFilesPanelRef = ref<{
    openPicker: () => void | Promise<void>
  } | null>(null)

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

  function altGreetRowId(): string {
    return generateShortId()
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
  const previewUserMarkSaving = ref(false)
  const charFormDialogError = ref('')
  const fileInputRef = ref<HTMLInputElement | null>(null)
  const portraitInputRef = ref<HTMLInputElement | null>(null)
  const charPortraitFile = ref<File | null>(null)
  const charPortraitObjectUrl = ref('')
  const portraitTick = ref(0)
  const listScrollRef = ref<HTMLElement | null>(null)
  const sentinelRef = ref<HTMLElement | null>(null)
  let io: IntersectionObserver | null = null
  let listFetchGen = 0
  let detailFetchGen = 0

  const selected = computed(() =>
    items.value.find((x) => x.id === selectedId.value) ?? null,
  )

  function bumpPortraitTick() {
    portraitTick.value++
  }

  function characterImageSrc(id: string) {
    return (
      characterImageUrl(auth.user?.id ?? auth.defaultUserId, id, {
        size: 'l',
        cacheBust: portraitTick.value,
      }) ?? ''
    )
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

  function sortOptionLabel(opt: CharacterSort): string {
    const keys: Record<CharacterSort, string> = {
      recentChat: 'characters.sortRecentChat',
      recentUpdate: 'characters.sortRecent',
      name: 'characters.sortName',
      usageCount: 'characters.sortUsageCount',
    }
    return t(keys[opt])
  }

  const sortLabel = computed(() => sortOptionLabel(sort.value))

  const sortSelectLabelRef = ref<HTMLElement | null>(null)
  const sortLabelTruncated = ref(false)

  function updateSortLabelTruncated() {
    const el = sortSelectLabelRef.value
    sortLabelTruncated.value = Boolean(
      el && el.scrollWidth > el.clientWidth + 1,
    )
  }

  watch(sortLabel, () => {
    void nextTick(updateSortLabelTruncated)
  })

  watch(locale, () => {
    void nextTick(updateSortLabelTruncated)
  })

  watch([kind, filter, searchDebounced, sort, sortOrder], () => {
    void reloadFromStart()
  })

  watch(selectedId, (id) => {
    if (!id) {
      detailFetchGen++
      detail.value = null
      detailLoading.value = false
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
    u.searchParams.set('limit', String(CHARACTER_LIST_PAGE))
    if (searchDebounced.value) u.searchParams.set('search', searchDebounced.value)
    if (kind.value !== 'all') u.searchParams.set('kind', kind.value)
    if (filter.value !== 'all') u.searchParams.set('filter', filter.value)
    u.searchParams.set('sort', sort.value)
    u.searchParams.set('order', sortOrder.value)
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
    const gen = ++listFetchGen
    try {
      const res = await apiFetch(buildQuery(offset))
      if (gen !== listFetchGen) return
      if (!res.ok) {
        errorText.value = t('characters.loadFailed')
        return
      }
      const data = (await res.json()) as ListResponse
      if (gen !== listFetchGen) return
      total.value = data.total
      if (data.filterCounts) {
        filterCounts.value = data.filterCounts
      }
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
      if (gen !== listFetchGen) return
      errorText.value = t('characters.loadFailed')
    } finally {
      if (gen === listFetchGen) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  async function reloadFromStart() {
    items.value = []
    total.value = 0
    filterCounts.value = {
      all: 0,
      used: 0,
      unused: 0,
      kindAll: 0,
      kindUser: 0,
      kindNotUser: 0,
    }
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
    const gen = ++detailFetchGen
    try {
      const res = await apiFetch(`/api/characters/${id}`)
      if (gen !== detailFetchGen) return
      if (!res.ok) {
        detail.value = null
        return
      }
      detail.value = (await res.json()) as CharacterDoc
    } catch {
      if (gen !== detailFetchGen) return
      detail.value = null
    } finally {
      if (gen === detailFetchGen) detailLoading.value = false
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

  watch([listScrollRef, sentinelRef], ([root, el]) => {
    if (root && el) setupObserver()
  })

  function bindListScrollEl(el: Element | null) {
    listScrollRef.value = el instanceof HTMLElement ? el : null
  }

  function bindSentinelEl(el: Element | null) {
    sentinelRef.value = el instanceof HTMLElement ? el : null
  }

  function bindFileInputEl(el: Element | null) {
    fileInputRef.value = el instanceof HTMLInputElement ? el : null
  }

  function bindPortraitInputEl(el: Element | null) {
    portraitInputRef.value = el instanceof HTMLInputElement ? el : null
  }

  function bindSortSelectLabelEl(el: Element | null) {
    sortSelectLabelRef.value = el instanceof HTMLElement ? el : null
    void nextTick(updateSortLabelTruncated)
  }

  function bindImageFilesPanel(
    el: { openPicker: () => void | Promise<void> } | null,
  ) {
    imageFilesPanelRef.value = el
  }

  function openImageFilesPicker() {
    void imageFilesPanelRef.value?.openPicker()
  }

  function selectCard(id: string) {
    selectedId.value = id
  }

  function setKind(k: CharacterKind) {
    kind.value = k
  }

  function setFilter(f: CharacterUsageFilter) {
    filter.value = f
  }

  function setSort(next: CharacterSort) {
    sort.value = next
  }

  function setSortOrder(next: CharacterSortOrder) {
    sortOrder.value = next
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
    const totalRows = charFormAlternateGreetings.value.length
    const filled = charFormAlternateGreetings.value.filter((r) =>
      r.text.trim(),
    ).length
    return { total: totalRows, filled }
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

  async function savePreviewUserMark(value: boolean | null) {
    if (value === null) return
    const id = selectedId.value
    if (!id || !detail.value) return
    const wasUser = detail.value.isUser === true
    if (wasUser === value) return
    previewUserMarkSaving.value = true
    try {
      const res = await apiFetch(`/api/characters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isUser: value }),
      })
      if (!res.ok) {
        coreNotify(t('characters.userMarkFailed'), undefined, { level: 'error' })
        return
      }
      const doc = (await res.json()) as CharacterDoc
      detail.value = doc
      const marked = doc.isUser === true
      const row = items.value.find((x) => x.id === id)
      if (row) row.isUser = marked
      if (wasUser !== marked) {
        if (marked) {
          filterCounts.value.kindUser++
          filterCounts.value.kindNotUser = Math.max(
            0,
            filterCounts.value.kindNotUser - 1,
          )
        } else {
          filterCounts.value.kindUser = Math.max(0, filterCounts.value.kindUser - 1)
          filterCounts.value.kindNotUser++
        }
      }
      const hiddenByKind =
        (kind.value === 'user' && !marked) ||
        (kind.value === 'notUser' && marked)
      if (hiddenByKind) {
        items.value = items.value.filter((x) => x.id !== id)
        total.value = Math.max(0, total.value - 1)
        if (selectedId.value === id) {
          selectedId.value = items.value[0]?.id ?? null
        }
      }
    } catch {
      coreNotify(t('characters.userMarkFailed'), undefined, { level: 'error' })
    } finally {
      previewUserMarkSaving.value = false
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
          res = await apiFetch('/api/characters', { method: 'POST', body: fd })
        } else {
          res = await apiFetch('/api/characters', {
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
        coreNotify(t('characters.createOk'), undefined, { level: 'success' })
        bumpPortraitTick()
        clearPortraitPick()
        await reloadFromStart()
      } else {
        if (!selectedId.value) return
        const id = selectedId.value
        const res = await apiFetch(`/api/characters/${id}`, {
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
          const res2 = await apiFetch(`/api/characters/${id}/portrait`, {
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
        coreNotify(t('characters.editOk'), undefined, { level: 'success' })
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
        const res = await apiFetch('/api/characters/import-png', {
          method: 'POST',
          body: fd,
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string }
          errorText.value = j.error ?? t('characters.importFailed')
          return
        }
        coreNotify(t('characters.importOk'), undefined, { level: 'success' })
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
      const res = await apiFetch('/api/characters/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: cardPayload }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        errorText.value = j.error ?? t('characters.importFailed')
        return
      }
      coreNotify(t('characters.importOk'), undefined, { level: 'success' })
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

  function parseContentDispositionFilename(header: string | null): string | null {
    if (!header) return null
    const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
    if (star?.[1]) {
      try {
        return decodeURIComponent(star[1].trim())
      } catch {
        /* ignore */
      }
    }
    const plain = /filename="([^"]+)"/i.exec(header)
    return plain?.[1] ?? null
  }

  function triggerDownloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function downloadCharacterExport(path: string, fallbackFilename: string) {
    await runExport(async () => {
      try {
        const res = await apiFetch(path)
        if (!res.ok) throw new Error('fail')
        const blob = await res.blob()
        const filename =
          parseContentDispositionFilename(res.headers.get('Content-Disposition')) ??
          fallbackFilename
        triggerDownloadBlob(blob, filename)
      } catch {
        throw new Error(t('characters.exportFailed'))
      }
    })
  }

  async function exportJson() {
    if (!selectedId.value || !detail.value) return
    const fallback = `${selected.value?.name?.trim() || selectedId.value}.json`
    await downloadCharacterExport(
      `/api/characters/${selectedId.value}/export-json`,
      fallback,
    )
  }

  async function exportPng() {
    if (!selectedId.value || !detail.value) return
    const fallback = `${selected.value?.name?.trim() || selectedId.value}.png`
    await downloadCharacterExport(
      `/api/characters/${selectedId.value}/export-png`,
      fallback,
    )
  }

  function openDelete() {
    if (!selected.value || !selectedId.value) return
    askDelete(selectedId.value, selected.value.name)
  }

  async function confirmDelete() {
    try {
      const ok = await confirmDeleteAction(async (id) => {
        const res = await apiFetch(`/api/characters/${id}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(t('characters.deleteFailed'))
      })
      if (ok) await reloadFromStart()
    } catch (e) {
      errorText.value =
        e instanceof Error && e.message
          ? e.message
          : t('characters.deleteFailed')
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
    void nextTick(updateSortLabelTruncated)
  })

  onUnmounted(() => {
    io?.disconnect()
    io = null
    if (searchTimer) clearTimeout(searchTimer)
    if (charPortraitObjectUrl.value) {
      URL.revokeObjectURL(charPortraitObjectUrl.value)
      charPortraitObjectUrl.value = ''
    }
  })

  return {
    CHARACTER_SORT_OPTIONS,
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
    imageFilesPanelRef,
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
    sortOptionLabel,
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
  }
}
