export type HomeListMode = 'conversations' | 'characters'
export type HomeCharacterSource = 'usedInChats' | 'allLibrary'

export const HOME_LIST_MODE_STORAGE_KEY = 'arousal-home-list-mode-default'
export const HOME_CHARACTER_SOURCE_STORAGE_KEY =
  'arousal-home-character-source-default'

const HOME_LIST_MODES: HomeListMode[] = ['conversations', 'characters']
const HOME_CHARACTER_SOURCES: HomeCharacterSource[] = [
  'usedInChats',
  'allLibrary',
]

export function normalizeHomeListMode(raw: unknown): HomeListMode {
  if (typeof raw === 'string' && HOME_LIST_MODES.includes(raw as HomeListMode)) {
    return raw as HomeListMode
  }
  return 'conversations'
}

export function normalizeHomeCharacterSource(
  raw: unknown,
): HomeCharacterSource {
  if (
    typeof raw === 'string' &&
    HOME_CHARACTER_SOURCES.includes(raw as HomeCharacterSource)
  ) {
    return raw as HomeCharacterSource
  }
  return 'usedInChats'
}

export function readHomeListModeDefault(): HomeListMode {
  try {
    return normalizeHomeListMode(
      localStorage.getItem(HOME_LIST_MODE_STORAGE_KEY),
    )
  } catch {
    return 'conversations'
  }
}

export function writeHomeListModeDefault(mode: HomeListMode): void {
  try {
    localStorage.setItem(HOME_LIST_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function readHomeCharacterSourceDefault(): HomeCharacterSource {
  try {
    return normalizeHomeCharacterSource(
      localStorage.getItem(HOME_CHARACTER_SOURCE_STORAGE_KEY),
    )
  } catch {
    return 'usedInChats'
  }
}

export function writeHomeCharacterSourceDefault(
  source: HomeCharacterSource,
): void {
  try {
    localStorage.setItem(HOME_CHARACTER_SOURCE_STORAGE_KEY, source)
  } catch {
    /* ignore */
  }
}
