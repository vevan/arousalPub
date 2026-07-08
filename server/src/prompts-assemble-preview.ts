import {
  assemblePrompts,
  type AssembleResult,
  type BoundCharacterSlice,
  type PromptPreset,
  type PromptTrigger,
} from './assemble-prompts.js'
import { buildPromptMacroContext } from './prompt-macros/index.js'
import { cardRecordToCharXmlBlock } from './prompt-xml.js'
import { extractMacroCharacterFields } from './prompt-macros/index.js'
import type { PromptsDocument } from './prompts-file.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'

const TRIGGERS: PromptTrigger[] = [
  'normal',
  'continue',
  'swipe',
  'regenerate',
]

function asPromptPreset(raw: unknown): PromptPreset | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<PromptPreset>
  if (typeof p.id !== 'string' || !p.id.trim()) return null
  if (!Array.isArray(p.groups) || !Array.isArray(p.prompts)) return null
  return p as PromptPreset
}

function normalizeTrigger(raw: unknown): PromptTrigger | undefined {
  if (raw === 'all' || raw === null || raw === undefined) return undefined
  if (typeof raw === 'string' && (TRIGGERS as string[]).includes(raw)) {
    return raw as PromptTrigger
  }
  return 'normal'
}

export interface PromptsAssemblePreviewBody {
  presetId?: string
  promptTrigger?: unknown
  conversationUserName?: string
  /** 省略时使用服务端内置示例角色（moka / cocoa） */
  characters?: BoundCharacterSlice[]
  model?: string
  contextLength?: number | null
  locale?: string
}

/** 提示词库预览用示例角色（XML 在服务端生成） */
export function defaultPreviewSampleCharacters(): BoundCharacterSlice[] {
  const mokaCard = {
    name: 'moka',
    description: 'Sample description',
    personality: 'Sample personality',
    scenario: 'Sample scenario',
    first_mes: 'Hello from moka',
    mes_example: '<START>\n{{user}}: hi\n{{char}}: hello',
    system_prompt: 'Sample system_prompt',
    post_history_instructions: 'Sample post_history',
    creator_notes: 'Sample creator notes',
    character_version: '1.0',
  }
  const cocoaCard = {
    name: 'cocoa',
    description: 'Cocoa description',
    personality: 'Cocoa personality',
  }
  return [
    {
      name: 'moka',
      cardBody: cardRecordToCharXmlBlock(mokaCard),
      systemPrompt: 'Sample system_prompt',
      postHistory: 'Sample post_history',
      macroFields: extractMacroCharacterFields(mokaCard),
    },
    {
      name: 'cocoa',
      cardBody: cardRecordToCharXmlBlock(cocoaCard),
      macroFields: extractMacroCharacterFields(cocoaCard),
    },
  ]
}

function resolvePreviewCharacters(
  body: PromptsAssemblePreviewBody,
): BoundCharacterSlice[] {
  const raw = body.characters
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.filter(
      (c) =>
        c &&
        typeof c === 'object' &&
        typeof c.cardBody === 'string' &&
        c.cardBody.trim().length > 0,
    )
  }
  return defaultPreviewSampleCharacters()
}

export function runPromptsAssemblePreview(
  doc: PromptsDocument,
  body: PromptsAssemblePreviewBody,
): AssembleResult | { error: string } {
  const presetId =
    typeof body.presetId === 'string' && body.presetId.trim()
      ? body.presetId.trim()
      : doc.activePresetId
  const raw = doc.presets.find((p) => {
    if (!p || typeof p !== 'object') return false
    return (p as { id?: string }).id === presetId
  })
  const preset = asPromptPreset(raw)
  if (!preset) {
    return { error: '无法解析提示词预设' }
  }
  const normalized = normalizePresetForAssemble(preset)

  const characters = resolvePreviewCharacters(body)
  const macroContext = buildPromptMacroContext({
    conversationUserName: body.conversationUserName,
    characters,
    model: body.model,
    contextLength: body.contextLength,
    locale: body.locale,
  })

  const maxT = body.contextLength
  const maxTokens =
    typeof maxT === 'number' && !Number.isNaN(maxT) && maxT > 0
      ? maxT
      : undefined

  return assemblePrompts(normalized, {
    trigger: normalizeTrigger(body.promptTrigger),
    bindingPlaceholderMode: true,
    characters,
    macroContext,
    tokenModel: typeof body.model === 'string' ? body.model : undefined,
    maxTokens,
  })
}
