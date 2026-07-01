import {
  filterComposerSlashCommands,
  mergeComposerSlashCatalog,
  type ComposerSlashCommandSpec,
} from '@/utils/composer-slash-catalog'
import {
  applyComposerSlashExample,
  getComposerSlashMenuContext,
} from '@/utils/composer-slash-menu'
import { listComposerSlashPluginSpecs } from '@/utils/composer-slash-registry'
import { computed, ref, type Ref } from 'vue'

export function useComposerSlashMenu(opts: {
  userInput: Ref<string>
  textareaRef: Ref<HTMLTextAreaElement | null>
}) {
  const activeIndex = ref(0)
  const menuCtx = ref<ReturnType<typeof getComposerSlashMenuContext>>(null)

  const catalog = computed(() =>
    mergeComposerSlashCatalog(listComposerSlashPluginSpecs()),
  )

  const filtered = computed(() => {
    if (!menuCtx.value) return []
    return filterComposerSlashCommands(
      catalog.value,
      menuCtx.value.commandQuery,
    )
  })

  const isOpen = computed(
    () => menuCtx.value !== null && filtered.value.length > 0,
  )

  function syncMenuFromInput() {
    const el = opts.textareaRef.value
    if (!el) {
      menuCtx.value = null
      activeIndex.value = 0
      return
    }
    const prevQuery = menuCtx.value?.commandQuery
    const nextCtx = getComposerSlashMenuContext(
      opts.userInput.value,
      el.selectionStart ?? 0,
    )
    menuCtx.value = nextCtx
    if (!nextCtx) {
      activeIndex.value = 0
      return
    }
    if (prevQuery === undefined || prevQuery !== nextCtx.commandQuery) {
      activeIndex.value = 0
    } else {
      clampActiveIndex()
    }
  }

  function closeMenu() {
    menuCtx.value = null
    activeIndex.value = 0
  }

  function clampActiveIndex() {
    const n = filtered.value.length
    if (n === 0) {
      activeIndex.value = 0
      return
    }
    if (activeIndex.value < 0) activeIndex.value = n - 1
    if (activeIndex.value >= n) activeIndex.value = 0
  }

  function moveActive(delta: number) {
    if (!isOpen.value) return false
    const n = filtered.value.length
    if (n === 0) return false
    activeIndex.value = (activeIndex.value + delta + n) % n
    return true
  }

  function acceptActive(): boolean {
    if (!isOpen.value || !menuCtx.value) return false
    const spec = filtered.value[activeIndex.value]
    if (!spec) return false
    applySpec(spec)
    return true
  }

  function applySpec(spec: ComposerSlashCommandSpec) {
    const ctx = menuCtx.value
    const el = opts.textareaRef.value
    if (!ctx || !el) return

    const { next, cursor } = applyComposerSlashExample(
      opts.userInput.value,
      ctx,
      spec.example,
    )
    opts.userInput.value = next
    closeMenu()
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = cursor
    })
  }

  function handleSlashKeydown(e: KeyboardEvent): boolean {
    if (!isOpen.value) return false

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveActive(1)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveActive(-1)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
      return true
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
      if (e.isComposing) return false
      e.preventDefault()
      return acceptActive()
    }
    return false
  }

  return {
    menuCtx,
    filtered,
    activeIndex,
    isOpen,
    syncMenuFromInput,
    closeMenu,
    applySpec,
    handleSlashKeydown,
    clampActiveIndex,
  }
}
