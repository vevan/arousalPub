import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getRegexRulesPath, getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'
import { allocateShortId, isValidShortId } from './short-id.js'
import {
  MAX_REGEX_LABEL_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  MAX_REGEX_REPLACEMENT_LENGTH,
  REGEX_FIELDS,
  REGEX_FLAGS_RE,
  REGEX_PHASES,
  REGEX_RULES_SCHEMA_VERSION,
  type RegexField,
  type RegexPhase,
  type RegexRule,
  type RegexRulesDocument,
} from './regex-rules-types.js'

export class RegexRulesValidationError extends Error {
  constructor(
    message: string,
    readonly code = 'regex_rules_validation_failed',
  ) {
    super(message)
    this.name = 'RegexRulesValidationError'
  }
}

function emptyDocument(): RegexRulesDocument {
  return {
    schemaVersion: REGEX_RULES_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    rules: [],
  }
}

function isRegexPhase(v: unknown): v is RegexPhase {
  return (
    typeof v === 'string' &&
    (REGEX_PHASES as readonly string[]).includes(v)
  )
}

function isRegexField(v: unknown): v is RegexField {
  return (
    typeof v === 'string' &&
    (REGEX_FIELDS as readonly string[]).includes(v)
  )
}

function uniqueStrings<T extends string>(items: T[]): T[] {
  return [...new Set(items)]
}

function parseSkipLastNTurnsField(raw: unknown, fieldName: string): number {
  if (
    typeof raw !== 'number' ||
    !Number.isFinite(raw) ||
    raw < 0
  ) {
    throw new RegexRulesValidationError(`${fieldName}_invalid`)
  }
  return Math.trunc(raw)
}

function parseSkipLastNTurnsOptional(raw: unknown, fieldName: string): number | undefined {
  if (raw === undefined) return undefined
  return parseSkipLastNTurnsField(raw, fieldName)
}

function validateRegExpPattern(pattern: string, flags: string): void {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    throw new RegexRulesValidationError('pattern_too_long')
  }
  if (!REGEX_FLAGS_RE.test(flags)) {
    throw new RegexRulesValidationError('invalid_flags')
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, flags)
  } catch {
    throw new RegexRulesValidationError('invalid_regexp')
  }
}

function normalizeRule(raw: unknown, usedIds: Set<string>): RegexRule {
  if (!raw || typeof raw !== 'object') {
    throw new RegexRulesValidationError('rule_invalid')
  }
  const o = raw as Record<string, unknown>

  let id = typeof o.id === 'string' ? o.id.trim() : ''
  if (id) {
    if (!isValidShortId(id)) {
      throw new RegexRulesValidationError('rule_id_invalid')
    }
    if (usedIds.has(id)) {
      throw new RegexRulesValidationError('rule_id_duplicate')
    }
  } else {
    id = allocateShortId(usedIds)
  }
  usedIds.add(id)

  const label =
    typeof o.label === 'string'
      ? o.label.trim().slice(0, MAX_REGEX_LABEL_LENGTH)
      : ''

  if (typeof o.order !== 'number' || !Number.isFinite(o.order)) {
    throw new RegexRulesValidationError('rule_order_invalid')
  }
  const order = Math.trunc(o.order)

  if (typeof o.enabled !== 'boolean') {
    throw new RegexRulesValidationError('rule_enabled_invalid')
  }

  if (!Array.isArray(o.phases) || o.phases.length === 0) {
    throw new RegexRulesValidationError('rule_phases_required')
  }
  const phases = uniqueStrings(
    o.phases.filter(isRegexPhase),
  ) as RegexPhase[]
  if (phases.length === 0) {
    throw new RegexRulesValidationError('rule_phases_invalid')
  }

  if (!Array.isArray(o.fields) || o.fields.length === 0) {
    throw new RegexRulesValidationError('rule_fields_required')
  }
  const fields = uniqueStrings(
    o.fields.filter(isRegexField),
  ) as RegexField[]
  if (fields.length === 0) {
    throw new RegexRulesValidationError('rule_fields_invalid')
  }

  let skipLastNTurns = 0
  if (o.skipLastNTurns !== undefined) {
    skipLastNTurns = parseSkipLastNTurnsField(o.skipLastNTurns, 'rule_skip_last_n')
  }
  const skipLastNTurnsDisplay =
    parseSkipLastNTurnsOptional(o.skipLastNTurnsDisplay, 'rule_skip_last_n_display') ??
    skipLastNTurns
  const skipLastNTurnsOutgoing =
    parseSkipLastNTurnsOptional(o.skipLastNTurnsOutgoing, 'rule_skip_last_n_outgoing') ??
    skipLastNTurns
  const skipLastNTurnsPersist =
    parseSkipLastNTurnsOptional(o.skipLastNTurnsPersist, 'rule_skip_last_n_persist') ??
    skipLastNTurns

  const pattern = typeof o.pattern === 'string' ? o.pattern : ''
  if (!pattern.trim()) {
    throw new RegexRulesValidationError('rule_pattern_required')
  }

  const flags = typeof o.flags === 'string' ? o.flags : 'g'
  validateRegExpPattern(pattern, flags)

  const replacement =
    typeof o.replacement === 'string'
      ? o.replacement.slice(0, MAX_REGEX_REPLACEMENT_LENGTH)
      : ''

  return {
    id,
    label,
    order,
    enabled: o.enabled,
    phases,
    fields,
    skipLastNTurns,
    skipLastNTurnsDisplay,
    skipLastNTurnsOutgoing,
    skipLastNTurnsPersist,
    pattern,
    flags,
    replacement,
  }
}

export function normalizeRegexRulesDocument(raw: unknown): RegexRulesDocument {
  if (!raw || typeof raw !== 'object') {
    throw new RegexRulesValidationError('document_invalid')
  }
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.rules)) {
    throw new RegexRulesValidationError('rules_must_be_array')
  }
  const usedIds = new Set<string>()
  const rules = o.rules.map((r) => normalizeRule(r, usedIds))
  return {
    schemaVersion: REGEX_RULES_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    rules,
  }
}

export async function readRegexRulesDocument(
  userId?: string,
): Promise<RegexRulesDocument> {
  const filePath = getRegexRulesPath(userId)
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return normalizeRegexRulesDocument(parsed)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return emptyDocument()
    if (e instanceof RegexRulesValidationError) throw e
    throw e
  }
}

export async function writeRegexRulesDocument(
  raw: unknown,
  userId?: string,
): Promise<RegexRulesDocument> {
  const normalized = normalizeRegexRulesDocument(raw)
  const uid = userId ?? getCurrentUserId()
  await mkdir(getUserDataDir(uid), { recursive: true })
  await writeFile(
    getRegexRulesPath(uid),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf8',
  )
  return normalized
}

/** 新建规则建议 order */
export function suggestNextRegexRuleOrder(rules: RegexRule[]): number {
  if (rules.length === 0) return 10
  return Math.max(...rules.map((r) => r.order)) + 10
}
