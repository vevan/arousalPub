import { ref, watch } from 'vue'

async function fetchCharacterDisplayName(id: string): Promise<string> {
  try {
    const res = await fetch(`/api/characters/${id}`)
    if (!res.ok) return id
    const doc = (await res.json()) as { card?: { name?: unknown } }
    const n = doc.card?.name
    return typeof n === 'string' && n.trim() ? n.trim() : id
  } catch {
    return id
  }
}

/** 绑定角色 displayName：优先 props，缺省或长度不齐时按 characterId 拉卡名 */
export function useBoundCharacterDisplayNames(opts: {
  getCharacterIds: () => string[] | undefined
  getPropDisplayNames: () => string[] | undefined
}) {
  const resolvedBoundDisplayNames = ref<string[]>([])

  async function refreshBoundDisplayNames() {
    const ids = opts.getCharacterIds()?.map((id) => id.trim()).filter(Boolean) ?? []
    const prop = opts.getPropDisplayNames()?.map((n) => n.trim()).filter(Boolean) ?? []
    if (ids.length === 0) {
      resolvedBoundDisplayNames.value = []
      return
    }
    if (prop.length === ids.length) {
      resolvedBoundDisplayNames.value = [...prop]
      return
    }
    resolvedBoundDisplayNames.value = await Promise.all(
      ids.map((id) => fetchCharacterDisplayName(id)),
    )
  }

  watch(
    () => [opts.getCharacterIds(), opts.getPropDisplayNames()] as const,
    () => {
      void refreshBoundDisplayNames()
    },
    { immediate: true, deep: true },
  )

  function getBoundDisplayNames(): string[] {
    if (resolvedBoundDisplayNames.value.length > 0) {
      return resolvedBoundDisplayNames.value
    }
    return opts.getPropDisplayNames() ?? []
  }

  return {
    resolvedBoundDisplayNames,
    getBoundDisplayNames,
  }
}
