import { authorsNoteMacroText } from './authors-note-settings.js'
import { readCharacterDocument } from './character-storage.js'
import { readApiSettingsFromFile } from './api-settings-file.js'
import {
  readConversationIndex,
  resolvedCharacterIds,
} from './chat-storage.js'
import {
  applyPromptMacroPipeline,
  buildPromptMacroContext,
  extractMacroCharacterFields,
  type MacroContextCharacterInput,
} from './prompt-macros/index.js'

export interface PluginMacroExpandRequest {
  text: string
  conversationId?: string
  apiConfigId?: string
  locale?: string
}

export type PluginMacroExpandResult =
  | { ok: true; text: string }
  | { ok: false; code: 'text_required' }

async function loadMacroCharacters(
  charIds: string[],
): Promise<MacroContextCharacterInput[]> {
  const out: MacroContextCharacterInput[] = []
  for (const id of charIds) {
    const doc = await readCharacterDocument(id.trim())
    if (!doc?.card || typeof doc.card !== 'object') continue
    const card = doc.card as Record<string, unknown>
    const nameRaw = card.name
    const name =
      typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined
    out.push({
      name,
      macroFields: extractMacroCharacterFields(card),
    })
  }
  return out
}

export async function runPluginMacroExpand(
  req: PluginMacroExpandRequest,
): Promise<PluginMacroExpandResult> {
  const text = typeof req.text === 'string' ? req.text : ''
  if (!text.trim()) {
    return { ok: false, code: 'text_required' }
  }

  let conversationUserName: string | null | undefined
  let characters: MacroContextCharacterInput[] = []
  let authorsNote: string | undefined

  const convId =
    typeof req.conversationId === 'string' ? req.conversationId.trim() : ''
  if (convId) {
    const idx = await readConversationIndex(convId)
    if (idx) {
      conversationUserName = idx.userName
      const charIds = resolvedCharacterIds(idx)
      characters = await loadMacroCharacters(charIds)
      authorsNote = authorsNoteMacroText(idx.authorsNote)
    }
  }

  let model: string | undefined
  let contextLength: number | undefined
  let maxResponseTokens: number | undefined
  const apiConfigId =
    typeof req.apiConfigId === 'string' ? req.apiConfigId.trim() : ''
  if (apiConfigId) {
    const settings = await readApiSettingsFromFile()
    const preset = settings?.presets.find((p) => p.id === apiConfigId) ?? null
    if (preset) {
      const m = (preset.model || '').trim()
      if (m) model = m
      if (
        typeof preset.contextLength === 'number' &&
        preset.contextLength > 0
      ) {
        contextLength = preset.contextLength
      }
      if (typeof preset.maxTokens === 'number' && preset.maxTokens > 0) {
        maxResponseTokens = preset.maxTokens
      }
    }
  }

  const macroContext = buildPromptMacroContext({
    conversationUserName,
    characters,
    model,
    contextLength,
    maxResponseTokens,
    authorsNote,
    locale: req.locale,
  })

  return { ok: true, text: applyPromptMacroPipeline(text, macroContext) }
}
