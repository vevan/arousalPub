/** llama.cpp / SillyTavern 风格的 DRY 采样器字段（OpenAI 官方 API 不支持） */

export interface DrySamplerFields {
  dryMultiplier: number | null
  dryBase: number | null
  dryAllowedLength: number | null
  dryPenaltyLastN: number | null
  drySequenceBreakers: string[]
}

export const DEFAULT_DRY_SEQUENCE_BREAKERS = ['\n', ':', '"', '*']

export function normalizeDrySequenceBreakers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    out.push(item)
  }
  return out
}

/** 文本框：每行一个 breaker；支持 `\n` 转义为换行符 */
export function parseDryBreakersFromTextarea(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    if (line === '') continue
    out.push(line.replace(/\\n/g, '\n').replace(/\\t/g, '\t'))
  }
  return out
}

export function formatDryBreakersForTextarea(breakers: string[]): string {
  return breakers
    .map((s) => s.replace(/\n/g, '\\n').replace(/\t/g, '\\t'))
    .join('\n')
}

export function appendDrySamplerToPayload(
  payload: Record<string, unknown>,
  fields: DrySamplerFields,
): void {
  const {
    dryMultiplier,
    dryBase,
    dryAllowedLength,
    dryPenaltyLastN,
    drySequenceBreakers,
  } = fields

  if (dryMultiplier !== undefined && dryMultiplier !== null) {
    payload.dry_multiplier = dryMultiplier
  }
  if (dryBase !== undefined && dryBase !== null) {
    payload.dry_base = dryBase
  }
  if (dryAllowedLength !== undefined && dryAllowedLength !== null) {
    payload.dry_allowed_length = dryAllowedLength
  }
  if (dryPenaltyLastN !== undefined && dryPenaltyLastN !== null) {
    payload.dry_penalty_last_n = dryPenaltyLastN
  }
  if (drySequenceBreakers.length > 0) {
    payload.dry_sequence_breakers = drySequenceBreakers
  }
}

export function hasAnyDrySamplerField(fields: DrySamplerFields): boolean {
  return (
    fields.dryMultiplier !== null ||
    fields.dryBase !== null ||
    fields.dryAllowedLength !== null ||
    fields.dryPenaltyLastN !== null ||
    fields.drySequenceBreakers.length > 0
  )
}
