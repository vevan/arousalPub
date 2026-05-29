export const DEFAULT_LOREBOOK_ID = 'lore-default'

export function pickDefaultLorebookIds(items: { id: string }[]): string[] {
  if (items.some((x) => x.id === DEFAULT_LOREBOOK_ID)) {
    return [DEFAULT_LOREBOOK_ID]
  }
  return items.length > 0 ? [items[0]!.id] : []
}

export async function fetchLorebookPickerItems(): Promise<{ id: string; name: string }[]> {
  const res = await fetch('/api/lorebooks')
  if (!res.ok) return []
  const raw = (await res.json()) as {
    lorebooks?: { id?: string; name?: string }[]
  } | null
  if (!raw || typeof raw !== 'object') return []
  return (raw.lorebooks ?? [])
    .filter((x) => typeof x.id === 'string' && x.id.trim())
    .map((x) => ({
      id: x.id as string,
      name:
        typeof x.name === 'string' && x.name.trim()
          ? x.name.trim()
          : (x.id as string),
    }))
}

export async function fetchDefaultLorebookIds(): Promise<string[]> {
  try {
    return pickDefaultLorebookIds(await fetchLorebookPickerItems())
  } catch {
    return [DEFAULT_LOREBOOK_ID]
  }
}
