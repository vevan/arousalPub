/**
 * SillyTavern OpenAI 预设 JSON 识别（导入分流用）。
 */

import type { StPresetJson } from './st-preset-import.js'

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x)
}

function isStPromptsArray(prompts: unknown): boolean {
  if (!Array.isArray(prompts) || prompts.length === 0) return false
  let withId = 0
  for (const item of prompts) {
    if (!isRecord(item)) continue
    if (typeof item.identifier === 'string' && item.identifier.trim()) {
      withId++
    }
  }
  return withId >= Math.min(3, prompts.length)
}

function isStPromptOrderArray(promptOrder: unknown): boolean {
  if (!Array.isArray(promptOrder) || promptOrder.length === 0) return false
  for (const block of promptOrder) {
    if (!isRecord(block)) continue
    if (!Array.isArray(block.order) || block.order.length === 0) continue
    for (const item of block.order) {
      if (!isRecord(item)) continue
      if (typeof item.identifier === 'string' && item.identifier.trim()) {
        return true
      }
    }
  }
  return false
}

/** ST OpenAI 预设（含 prompts + prompt_order） */
export function isStOpenAiPreset(raw: unknown): raw is StPresetJson {
  if (!isRecord(raw)) return false
  return isStPromptsArray(raw.prompts) && isStPromptOrderArray(raw.prompt_order)
}

export type PromptImportKind = 'native' | 'st' | 'unknown'

/** 原生 arousalPub 预设形状（与 web store 一致） */
export function isNativePromptPresetShape(raw: unknown): boolean {
  if (!isRecord(raw)) return false
  return (
    typeof raw.id === 'string' &&
    Array.isArray(raw.groups) &&
    Array.isArray(raw.prompts)
  )
}

function extractNativePresetsFromImport(raw: unknown): unknown[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.filter(isNativePromptPresetShape)
  }
  if (!isRecord(raw)) return []
  if (Array.isArray(raw.presets)) {
    return raw.presets.filter(isNativePromptPresetShape)
  }
  if (isNativePromptPresetShape(raw.preset)) {
    return [raw.preset]
  }
  if (isNativePromptPresetShape(raw)) {
    return [raw]
  }
  if (
    raw.schema === 'arousal-prompts-preset@1' &&
    isNativePromptPresetShape(raw.preset)
  ) {
    return [raw.preset]
  }
  return []
}

/** 导入 JSON 分流：优先原生，其次 ST */
export function detectPromptImportKind(raw: unknown): PromptImportKind {
  if (extractNativePresetsFromImport(raw).length > 0) return 'native'
  if (isStOpenAiPreset(raw)) return 'st'
  return 'unknown'
}

/** 从文件名生成预设显示名 */
export function formatFilenameAsPresetName(filename: string): string {
  let base = filename.replace(/\.(json|preset\.json)$/i, '').trim()
  base = base.replace(/[\\/:*?"<>|]/g, '_')
  base = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return base || 'Imported preset'
}
