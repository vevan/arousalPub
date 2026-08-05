import type { GroupKind, PromptEntry } from '@/stores/prompts'

export function groupBoundDescKey(kind: GroupKind): string {
  switch (kind) {
    case 'character':
      return 'prompts.groupBoundDescCharacter'
    case 'world':
      return 'prompts.groupBoundDescWorld'
    case 'history':
      return 'prompts.groupBoundDescHistory'
    case 'userInput':
      return 'prompts.groupBoundDescUserInput'
    default:
      return ''
  }
}

export function showHistoryTokenTrim(kind: GroupKind | undefined): boolean {
  return kind === 'history'
}

export function groupBoundTitleKey(kind: GroupKind | undefined): string {
  switch (kind) {
    case 'character':
      return 'prompts.groupBoundTitleCharacter'
    case 'world':
      return 'prompts.groupBoundTitleWorld'
    case 'history':
      return 'prompts.groupBoundTitleHistory'
    case 'userInput':
      return 'prompts.groupBoundTitleUserInput'
    default:
      return 'prompts.groupBoundFromChat'
  }
}

export function bindingSlotBundlePartsKey(slot: string | undefined): string | null {
  switch (slot) {
    case 'boundUserPersona':
      return 'prompts.boundUserPersonaBundleParts'
    case 'boundCharSystemPrompt':
      return 'prompts.boundCharSystemPromptBundleParts'
    case 'boundCharDescription':
      return 'prompts.boundCharDescriptionBundleParts'
    case 'boundChatHistory':
      return 'prompts.boundChatHistoryBundleParts'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterPostHistoryBundleParts'
    default:
      return null
  }
}

export function bindingSlotIsRequired(slot: string | undefined): boolean {
  return (
    slot === 'boundWorldBefore' ||
    slot === 'boundWorldAfter' ||
    slot === 'boundUserInput' ||
    slot === 'boundUserPersona'
  )
}

export function bindingSlotAllowsToggle(slot: string | undefined): boolean {
  return !bindingSlotIsRequired(slot)
}

/** 正文来自预设本身（ST main / enhanceDefinitions），可编辑 */
export function bindingSlotHasEditableContent(slot: string | undefined): boolean {
  return slot === 'boundMain' || slot === 'boundEnhanceDefinitions'
}

export function bindingSlotLabelKey(slot: string | undefined): string {
  switch (slot) {
    case 'boundUserPersona':
      return 'prompts.boundUserPersonaLabel'
    case 'boundWorldBefore':
      return 'prompts.boundWorldBeforeLabel'
    case 'boundWorldAfter':
      return 'prompts.boundWorldAfterLabel'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterPostHistoryLabel'
    case 'boundUserInput':
      return 'prompts.boundUserInputLabel'
    case 'boundMain':
      return 'prompts.boundMainLabel'
    case 'boundCharSystemPrompt':
      return 'prompts.boundCharSystemPromptLabel'
    case 'boundCharDescription':
      return 'prompts.boundCharDescriptionLabel'
    case 'boundCharPersonality':
      return 'prompts.boundCharPersonalityLabel'
    case 'boundScenario':
      return 'prompts.boundScenarioLabel'
    case 'boundEnhanceDefinitions':
      return 'prompts.boundEnhanceDefinitionsLabel'
    case 'boundDialogueExamples':
      return 'prompts.boundDialogueExamplesLabel'
    case 'boundChatHistory':
      return 'prompts.boundChatHistoryLabel'
    default:
      return 'prompts.untitled'
  }
}

export function bindingSlotListHintKey(slot: string | undefined): string {
  switch (slot) {
    case 'boundMain':
      return 'prompts.boundMainListHint'
    case 'boundEnhanceDefinitions':
      return 'prompts.boundEnhanceDefinitionsListHint'
    case 'boundCharSystemPrompt':
      return 'prompts.boundCharSystemPromptListHint'
    case 'boundUserPersona':
      return 'prompts.boundUserPersonaListHint'
    case 'boundCharDescription':
      return 'prompts.boundCharDescriptionListHint'
    case 'boundCharPersonality':
      return 'prompts.boundCharPersonalityListHint'
    case 'boundScenario':
      return 'prompts.boundScenarioListHint'
    case 'boundWorldBefore':
    case 'boundWorldAfter':
      return 'prompts.boundWorldListHint'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterListHintPost'
    case 'boundChatHistory':
      return 'prompts.boundChatHistoryListHint'
    case 'boundUserInput':
      return 'prompts.boundUserInputListHint'
    default:
      return 'prompts.emptyHint'
  }
}

export function bindingSlotEditorDescKey(slot: string | undefined): string {
  switch (slot) {
    case 'boundMain':
      return 'prompts.boundMainEditorDesc'
    case 'boundEnhanceDefinitions':
      return 'prompts.boundEnhanceDefinitionsEditorDesc'
    case 'boundCharSystemPrompt':
      return 'prompts.boundCharSystemPromptEditorDesc'
    case 'boundUserPersona':
      return 'prompts.boundUserPersonaEditorDesc'
    case 'boundCharDescription':
      return 'prompts.boundCharDescriptionEditorDesc'
    case 'boundCharPersonality':
      return 'prompts.boundCharPersonalityEditorDesc'
    case 'boundScenario':
      return 'prompts.boundScenarioEditorDesc'
    case 'boundWorldBefore':
    case 'boundWorldAfter':
      return 'prompts.boundWorldEditorDesc'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterEditorDescPost'
    case 'boundChatHistory':
      return 'prompts.boundChatHistoryEditorDesc'
    case 'boundUserInput':
      return 'prompts.boundUserInputEditorDesc'
    default:
      return 'prompts.editorEmptyHint'
  }
}

export function groupIcon(kind: GroupKind): string {
  switch (kind) {
    case 'character':
      return 'mdi-account-outline'
    case 'world':
      return 'mdi-earth'
    case 'history':
      return 'mdi-chat-outline'
    case 'userInput':
      return 'mdi-pencil-outline'
    default:
      return 'mdi-format-list-bulleted'
  }
}

export function previewPromptBody(p: PromptEntry): string {
  const raw = (p.description || p.content).replace(/\s+/g, ' ').trim()
  if (raw.length <= 80) return raw
  return raw.slice(0, 78).trimEnd() + '…'
}

export function formatPromptDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return iso
  }
}
