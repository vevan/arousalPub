import type {
  PluginSettingsFieldSchema,
  PluginSettingsItemFieldSchema,
  PluginSettingsSchema,
} from './types.js'

export class PluginSettingsValidationError extends Error {
  readonly code = 'plugin_settings_invalid' as const

  constructor(message: string) {
    super(message)
    this.name = 'PluginSettingsValidationError'
  }
}

export function normalizeSettingsSchema(
  raw: unknown,
): PluginSettingsSchema | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Partial<PluginSettingsSchema>
  if (typeof doc.version !== 'number' || !Number.isFinite(doc.version)) {
    return null
  }
  const fields: PluginSettingsFieldSchema[] = []
  if (Array.isArray(doc.fields)) {
    for (const item of doc.fields) {
      const f = normalizeField(item)
      if (f) fields.push(f)
    }
  }
  return { version: Math.round(doc.version), fields }
}

function normalizeItemField(
  raw: unknown,
): PluginSettingsItemFieldSchema | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const key = typeof o.key === 'string' ? o.key.trim() : ''
  const type = typeof o.type === 'string' ? o.type.trim() : ''
  const labelKey = typeof o.labelKey === 'string' ? o.labelKey.trim() : ''
  if (!key || !labelKey) return null
  const allowed = new Set([
    'boolean',
    'integer',
    'number',
    'string',
    'text',
    'enum',
  ])
  if (!allowed.has(type)) return null
  const field: PluginSettingsItemFieldSchema = {
    key,
    type: type as PluginSettingsItemFieldSchema['type'],
    labelKey,
  }
  if (typeof o.descriptionKey === 'string' && o.descriptionKey.trim()) {
    field.descriptionKey = o.descriptionKey.trim()
  }
  if ('default' in o) field.default = o.default
  if (typeof o.min === 'number' && Number.isFinite(o.min)) field.min = o.min
  if (typeof o.max === 'number' && Number.isFinite(o.max)) field.max = o.max
  if (typeof o.maxLength === 'number' && Number.isFinite(o.maxLength)) {
    field.maxLength = Math.round(o.maxLength)
  }
  if (Array.isArray(o.enum)) {
    field.enum = o.enum.filter((x): x is string => typeof x === 'string')
  }
  if (o.required === true) field.required = true
  if (typeof o.defaultKey === 'string' && o.defaultKey.trim()) {
    field.defaultKey = o.defaultKey.trim()
  }
  if (o.widget === 'promptTemplate') field.widget = 'promptTemplate'
  return field
}

function normalizeField(raw: unknown): PluginSettingsFieldSchema | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const key = typeof o.key === 'string' ? o.key.trim() : ''
  const type = typeof o.type === 'string' ? o.type.trim() : ''
  const labelKey = typeof o.labelKey === 'string' ? o.labelKey.trim() : ''
  if (!key || !labelKey) return null
  const allowed = new Set([
    'boolean',
    'integer',
    'number',
    'string',
    'text',
    'enum',
    'fileAsset',
    'apiPreset',
    'lorebook',
    'objectList',
    'checkboxGroup',
  ])
  if (!allowed.has(type)) return null
  const field: PluginSettingsFieldSchema = {
    key,
    type: type as PluginSettingsFieldSchema['type'],
    labelKey,
  }
  if (typeof o.descriptionKey === 'string' && o.descriptionKey.trim()) {
    field.descriptionKey = o.descriptionKey.trim()
  }
  if ('default' in o) field.default = o.default
  if (typeof o.min === 'number' && Number.isFinite(o.min)) field.min = o.min
  if (typeof o.max === 'number' && Number.isFinite(o.max)) field.max = o.max
  if (typeof o.maxLength === 'number' && Number.isFinite(o.maxLength)) {
    field.maxLength = Math.round(o.maxLength)
  }
  if (Array.isArray(o.enum)) {
    field.enum = o.enum.filter((x): x is string => typeof x === 'string')
  }
  if (Array.isArray(o.accept)) {
    field.accept = o.accept.filter((x): x is string => typeof x === 'string')
  }
  if (typeof o.purpose === 'string' && o.purpose.trim()) {
    field.purpose = o.purpose.trim()
  }
  if (o.visibleWhen && typeof o.visibleWhen === 'object') {
    const vw = o.visibleWhen as Record<string, unknown>
    const vf = typeof vw.field === 'string' ? vw.field.trim() : ''
    if (vf && 'equals' in vw) {
      field.visibleWhen = { field: vf, equals: vw.equals }
    }
  }
  if (o.widget === 'slider') field.widget = 'slider'
  if (o.widget === 'promptTemplate') field.widget = 'promptTemplate'
  if (typeof o.step === 'number' && Number.isFinite(o.step) && o.step > 0) {
    field.step = o.step
  }
  if (o.required === true) field.required = true
  if (typeof o.defaultKey === 'string' && o.defaultKey.trim()) {
    field.defaultKey = o.defaultKey.trim()
  }
  if (Array.isArray(o.itemFields)) {
    const items: PluginSettingsItemFieldSchema[] = []
    for (const item of o.itemFields) {
      const f = normalizeItemField(item)
      if (f) items.push(f)
    }
    if (items.length > 0) field.itemFields = items
  }
  if (o.conversationInherit === true) field.conversationInherit = true
  if (typeof o.inheritFromGlobalKey === 'string' && o.inheritFromGlobalKey.trim()) {
    field.inheritFromGlobalKey = o.inheritFromGlobalKey.trim()
  }
  if (Array.isArray(o.options)) {
    const options = o.options
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const opt = item as Record<string, unknown>
        const value = typeof opt.value === 'string' ? opt.value.trim() : ''
        if (!value) return null
        const out: { value: string; label?: string; labelKey?: string } = { value }
        if (typeof opt.label === 'string' && opt.label.trim()) {
          out.label = opt.label.trim()
        }
        if (typeof opt.labelKey === 'string' && opt.labelKey.trim()) {
          out.labelKey = opt.labelKey.trim()
        }
        return out
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    if (options.length > 0) field.options = options
  }
  if (o.optionsSource === 'regex-rules') {
    field.optionsSource = 'regex-rules'
  }
  if (o.optionsFilter && typeof o.optionsFilter === 'object') {
    const of = o.optionsFilter as Record<string, unknown>
    const filter: { enabled?: boolean; phases?: string[] } = {}
    if (of.enabled === true) filter.enabled = true
    if (Array.isArray(of.phases)) {
      filter.phases = of.phases.filter((x): x is string => typeof x === 'string')
    }
    if (filter.enabled || (filter.phases?.length ?? 0) > 0) {
      field.optionsFilter = filter
    }
  }
  if (o.collapsible === true) field.collapsible = true
  if (Array.isArray(o.panelFieldKeys)) {
    const keys = o.panelFieldKeys
      .filter((x): x is string => typeof x === 'string' && x.trim())
      .map((x) => x.trim())
    if (keys.length > 0) field.panelFieldKeys = keys
  }
  return field
}

export function schemaDefaults(
  schema: PluginSettingsSchema | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { schemaVersion: schema?.version ?? 1 }
  if (!schema) return out
  for (const field of schema.fields) {
    if ('default' in field) out[field.key] = field.default
  }
  return out
}

export function validatePluginSettings(
  schema: PluginSettingsSchema | null | undefined,
  raw: unknown,
): Record<string, unknown> {
  const base = schemaDefaults(schema)
  if (!schema || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return base
  }
  const input = raw as Record<string, unknown>
  const out: Record<string, unknown> = {
    schemaVersion: schema.version,
  }
  for (const field of schema.fields) {
    out[field.key] = coerceField(field, input[field.key], base[field.key])
  }
  return out
}

export function validatePluginSettingsStrict(
  schema: PluginSettingsSchema | null | undefined,
  raw: unknown,
): Record<string, unknown> {
  const doc = validatePluginSettings(schema, raw)
  if (!schema) return doc
  for (const field of schema.fields) {
    assertFieldValid(field, doc[field.key])
  }
  return doc
}

function assertFieldValid(
  field: PluginSettingsFieldSchema,
  value: unknown,
): void {
  if (field.type === 'objectList') {
    const items = parseObjectListValue(value)
    const itemFields = field.itemFields ?? []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new PluginSettingsValidationError(
          `${field.key}[${i}] invalid`,
        )
      }
      for (const sub of itemFields) {
        assertItemFieldValid(sub, (item as Record<string, unknown>)[sub.key], i)
      }
    }
    return
  }
  if (!field.required) return
  if (!isNonEmptyText(value)) {
    throw new PluginSettingsValidationError(`${field.key} required`)
  }
}

function assertItemFieldValid(
  field: PluginSettingsItemFieldSchema,
  value: unknown,
  index: number,
): void {
  if (!field.required) return
  if (field.type === 'boolean' || field.type === 'integer' || field.type === 'number') {
    return
  }
  if (!isNonEmptyText(value)) {
    throw new PluginSettingsValidationError(
      `${field.key}[${index}].${field.key} required`,
    )
  }
}

function isNonEmptyText(value: unknown): boolean {
  if (value == null) return false
  return String(value).trim().length > 0
}

function parseObjectListValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    try {
      const parsed = JSON.parse(s) as unknown
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function parseStringArrayValue(value: unknown, fallback: unknown): string[] {
  let arr: unknown[] = []
  if (Array.isArray(value)) {
    arr = value
  } else if (typeof value === 'string') {
    const s = value.trim()
    if (s) {
      try {
        const parsed = JSON.parse(s) as unknown
        if (Array.isArray(parsed)) arr = parsed
      } catch {
        arr = []
      }
    }
  } else if (Array.isArray(fallback)) {
    return fallback.filter((x): x is string => typeof x === 'string' && x.trim()).map((x) => x.trim())
  }
  return arr
    .filter((x): x is string => typeof x === 'string' && x.trim())
    .map((x) => x.trim())
}

function coerceField(
  field: PluginSettingsFieldSchema,
  value: unknown,
  fallback: unknown,
): unknown {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : Boolean(fallback ?? false)
    case 'integer': {
      const n =
        typeof value === 'number'
          ? Math.round(value)
          : typeof value === 'string'
            ? Math.round(Number(value))
            : NaN
      if (!Number.isFinite(n)) {
        return typeof fallback === 'number' ? Math.round(fallback) : 0
      }
      let v = n
      if (typeof field.min === 'number') v = Math.max(field.min, v)
      if (typeof field.max === 'number') v = Math.min(field.max, v)
      return v
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value))
      if (!Number.isFinite(n)) {
        return typeof fallback === 'number' ? fallback : 0
      }
      let v = n
      if (typeof field.min === 'number') v = Math.max(field.min, v)
      if (typeof field.max === 'number') v = Math.min(field.max, v)
      return v
    }
    case 'objectList': {
      const items = parseObjectListValue(value)
      const itemFields = field.itemFields ?? []
      const coerced = items
        .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
        .map((rawItem, index) =>
          coerceObjectListItem(itemFields, rawItem as Record<string, unknown>, index),
        )
      return JSON.stringify(coerced)
    }
    case 'string':
    case 'text':
    case 'apiPreset':
    case 'lorebook': {
      const s = typeof value === 'string' ? value : value != null ? String(value) : ''
      const trimmed = field.type === 'text' ? s : s.trim()
      const maxLen = field.maxLength ?? (field.type === 'text' ? 8000 : 500)
      const clipped = trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
      if (
        !clipped &&
        !field.required &&
        typeof fallback === 'string' &&
        fallback.trim()
      ) {
        return fallback
      }
      return clipped
    }
    case 'enum': {
      const opts = field.enum ?? []
      if (typeof value === 'string' && opts.includes(value)) return value
      if (typeof fallback === 'string' && opts.includes(fallback)) return fallback
      return opts[0] ?? ''
    }
    case 'fileAsset': {
      const s = typeof value === 'string' ? value.trim() : ''
      if (!s) return typeof fallback === 'string' ? fallback : ''
      const base = pathBasename(s)
      if (!base || base.includes('..')) return ''
      return base
    }
    case 'checkboxGroup':
      return parseStringArrayValue(value, fallback)
    default:
      return fallback
  }
}

function coerceObjectListItem(
  itemFields: PluginSettingsItemFieldSchema[],
  raw: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (typeof raw.id === 'string' && raw.id.trim()) {
    out.id = raw.id.trim()
  } else {
    out.id = `item-${index}-${Date.now().toString(36)}`
  }
  for (const sub of itemFields) {
    out[sub.key] = coerceItemField(sub, raw[sub.key])
  }
  return out
}

function coerceItemField(
  field: PluginSettingsItemFieldSchema,
  value: unknown,
): unknown {
  const fallback = 'default' in field ? field.default : undefined
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : Boolean(fallback ?? false)
    case 'integer': {
      const n =
        typeof value === 'number'
          ? Math.round(value)
          : typeof value === 'string'
            ? Math.round(Number(value))
            : NaN
      if (!Number.isFinite(n)) {
        return typeof fallback === 'number' ? Math.round(fallback) : 0
      }
      let v = n
      if (typeof field.min === 'number') v = Math.max(field.min, v)
      if (typeof field.max === 'number') v = Math.min(field.max, v)
      return v
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value))
      if (!Number.isFinite(n)) {
        return typeof fallback === 'number' ? fallback : 0
      }
      let v = n
      if (typeof field.min === 'number') v = Math.max(field.min, v)
      if (typeof field.max === 'number') v = Math.min(field.max, v)
      return v
    }
    case 'string':
    case 'text': {
      const s = typeof value === 'string' ? value : value != null ? String(value) : ''
      const trimmed = field.type === 'text' ? s : s.trim()
      const maxLen = field.maxLength ?? (field.type === 'text' ? 8000 : 200)
      const clipped = trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed
      if (!clipped && typeof fallback === 'string' && fallback.trim()) {
        return fallback
      }
      return clipped
    }
    case 'enum': {
      const opts = field.enum ?? []
      if (typeof value === 'string' && opts.includes(value)) return value
      if (typeof fallback === 'string' && opts.includes(fallback)) return fallback
      return opts[0] ?? ''
    }
    default:
      return fallback
  }
}

function pathBasename(name: string): string {
  const n = name.replace(/\\/g, '/').split('/').pop() ?? ''
  return n.trim()
}
