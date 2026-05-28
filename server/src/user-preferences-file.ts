import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getUserDataDir } from './config.js'
import {
  HISTORY_SETTINGS_DEFAULTS,
  normalizeHistorySettings,
  type HistorySettings,
} from './history-settings.js'
import {
  LOREBOOK_SETTINGS_DEFAULTS,
  normalizeLorebookSettings,
  type LorebookSettings,
} from './lorebook-settings.js'

export interface UserPreferencesDocument {
  version: 1
  savedAt: string
  lorebook?: Partial<LorebookSettings>
  history?: Partial<HistorySettings>
}

function userPreferencesPath(): string {
  return path.join(getUserDataDir(), 'user-preferences.json')
}

async function readPreferencesFileRaw(): Promise<UserPreferencesDocument | null> {
  try {
    const raw = await readFile(userPreferencesPath(), 'utf8')
    const doc = JSON.parse(raw) as UserPreferencesDocument
    if (doc?.version === 1) return doc
  } catch {
    /* missing */
  }
  return null
}

export async function readGlobalLorebookSettings(): Promise<LorebookSettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...LOREBOOK_SETTINGS_DEFAULTS }
  return normalizeLorebookSettings(doc.lorebook)
}

export async function readGlobalHistorySettings(): Promise<HistorySettings> {
  const doc = await readPreferencesFileRaw()
  if (!doc) return { ...HISTORY_SETTINGS_DEFAULTS }
  return normalizeHistorySettings(doc.history)
}

export async function readUserPreferencesDocument(): Promise<UserPreferencesDocument> {
  const doc = await readPreferencesFileRaw()
  const lorebook = normalizeLorebookSettings(doc?.lorebook)
  const history = normalizeHistorySettings(doc?.history)
  return {
    version: 1,
    savedAt:
      typeof doc?.savedAt === 'string' ? doc.savedAt : new Date().toISOString(),
    lorebook,
    history,
  }
}

async function writeUserPreferencesDocument(
  partial: Pick<UserPreferencesDocument, 'lorebook' | 'history'>,
): Promise<UserPreferencesDocument> {
  const prev = await readUserPreferencesDocument()
  const doc: UserPreferencesDocument = {
    version: 1,
    savedAt: new Date().toISOString(),
    lorebook: partial.lorebook ?? prev.lorebook,
    history: partial.history ?? prev.history,
  }
  await mkdir(getUserDataDir(), { recursive: true })
  await writeFile(userPreferencesPath(), JSON.stringify(doc, null, 2), 'utf8')
  return doc
}

export async function updateGlobalLorebookSettings(
  patch: Partial<LorebookSettings>,
): Promise<LorebookSettings> {
  const prev = await readUserPreferencesDocument()
  const lorebook = normalizeLorebookSettings({
    ...prev.lorebook,
    ...patch,
  })
  await writeUserPreferencesDocument({ lorebook, history: prev.history })
  return lorebook
}

export async function updateGlobalHistorySettings(
  patch: Partial<HistorySettings>,
): Promise<HistorySettings> {
  const prev = await readUserPreferencesDocument()
  const history = normalizeHistorySettings({
    ...prev.history,
    ...patch,
  })
  await writeUserPreferencesDocument({ lorebook: prev.lorebook, history })
  return history
}
