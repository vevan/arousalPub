import type { StPresetJson } from './st-preset-import.js'

export const ST_PRESET_MAX_PROMPTS = 512
export const ST_PRESET_MAX_ORDER_ITEMS = 512
export const ST_PRESET_MAX_FIELD_CHARS = 256_000
export const ST_PRESET_MAX_IDENTIFIER_CHARS = 128

export class StPresetValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StPresetValidationError'
  }
}

function assertFieldLength(
  label: string,
  value: string | undefined,
  max: number,
): void {
  if (value != null && value.length > max) {
    throw new StPresetValidationError(`${label} exceeds ${max} characters`)
  }
}

/** ST 预设输入体量上限（convert / detect 前调用） */
export function assertStPresetWithinLimits(raw: StPresetJson): void {
  const prompts = raw.prompts ?? []
  if (prompts.length > ST_PRESET_MAX_PROMPTS) {
    throw new StPresetValidationError(
      `prompts exceeds ${ST_PRESET_MAX_PROMPTS} items`,
    )
  }
  for (const p of prompts) {
    assertFieldLength('identifier', p.identifier, ST_PRESET_MAX_IDENTIFIER_CHARS)
    assertFieldLength('name', p.name, ST_PRESET_MAX_FIELD_CHARS)
    assertFieldLength('content', p.content, ST_PRESET_MAX_FIELD_CHARS)
  }
  for (const block of raw.prompt_order ?? []) {
    const order = block.order ?? []
    if (order.length > ST_PRESET_MAX_ORDER_ITEMS) {
      throw new StPresetValidationError(
        `prompt_order exceeds ${ST_PRESET_MAX_ORDER_ITEMS} items`,
      )
    }
    for (const item of order) {
      assertFieldLength(
        'order.identifier',
        item.identifier,
        ST_PRESET_MAX_IDENTIFIER_CHARS,
      )
    }
  }
}
