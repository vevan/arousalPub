import type {
  PluginSettingsItemFieldSchema,
  PluginSettingsSchema,
} from '@/plugins/plugin-settings-types'
import { pluginI18nKey } from '@/utils/plugin-settings-api'
import {
  hasPluginLocaleMessage,
  readPluginLocaleMessage,
  translatePluginI18nKey,
} from '@/utils/plugin-locale-text'
import { allocateShortId } from '@/utils/short-id'

export function parseObjectListField(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (x): x is Record<string, unknown> =>
        Boolean(x) && typeof x === 'object' && !Array.isArray(x),
    )
  }
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    try {
      const parsed = JSON.parse(s) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (x): x is Record<string, unknown> =>
          Boolean(x) && typeof x === 'object' && !Array.isArray(x),
      )
    } catch {
      return []
    }
  }
  return []
}

export function serializeObjectListField(
  items: Record<string, unknown>[],
): string {
  return JSON.stringify(items)
}

function isNonEmptyText(value: unknown): boolean {
  if (value == null) return false
  return String(value).trim().length > 0
}

function itemFieldRequiredEmpty(
  field: PluginSettingsItemFieldSchema,
  value: unknown,
): boolean {
  if (!field.required) return false
  if (field.type === 'boolean' || field.type === 'integer' || field.type === 'number') {
    return false
  }
  return !isNonEmptyText(value)
}

export function parseCheckboxGroupField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim())
  }
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    try {
      const parsed = JSON.parse(s) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
    } catch {
      return []
    }
  }
  return []
}

const TRACE_KEEPER_PLUGIN_ID = 'trace-keeper'
const TRACE_KEEPER_BUILTIN_BUNDLE_ID = 'scene-tracker-default'

export type SampleStateJsonValidation = 'empty' | 'valid' | 'invalid'

export function traceKeeperSampleStateJsonValidationEnabled(
  model: Record<string, unknown>,
): boolean {
  return model.validateSampleStateJson !== false
}

export function classifySampleStateJsonText(
  jsonText: string,
): SampleStateJsonValidation {
  const trimmed = jsonText.trim()
  if (!trimmed) return 'empty'
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'invalid'
    }
    return 'valid'
  } catch {
    return 'invalid'
  }
}

export function sampleStateInvalidJsonMessage(
  pluginId: string,
  t: (key: string) => string,
  te: (key: string) => boolean,
): string {
  const key = pluginI18nKey(pluginId, 'sampleStateInvalidJson')
  return translatePluginI18nKey(key, t, te)
}

function validateTraceKeeperBundleList(
  model: Record<string, unknown>,
  pluginId: string,
  t: (key: string) => string,
  te: (key: string) => boolean,
): string | null {
  if (pluginId !== TRACE_KEEPER_PLUGIN_ID) return null
  if (!traceKeeperSampleStateJsonValidationEnabled(model)) return null
  const items = parseObjectListField(model.bundleList)
  for (const item of items) {
    const label = String(item.label ?? '').trim()
    if (!label) {
      const key = pluginI18nKey(pluginId, 'bundleNameRequired')
      return translatePluginI18nKey(key, t, te)
    }
    const id = String(item.id ?? '').trim()
    if (!id) {
      const key = pluginI18nKey(pluginId, 'bundleIdRequired')
      return translatePluginI18nKey(key, t, te)
    }
    const jsonText = String(item.sampleStateJson ?? '')
    if (classifySampleStateJsonText(jsonText) === 'invalid') {
      return sampleStateInvalidJsonMessage(pluginId, t, te)
    }
  }
  return null
}

export function validatePluginSettingsModel(
  schema: PluginSettingsSchema | null | undefined,
  model: Record<string, unknown>,
  t: (key: string) => string,
  te: (key: string) => boolean,
  pluginId: string,
): string | null {
  if (!schema) return null
  for (const field of schema.fields) {
    if (field.type === 'objectList') {
      const items = parseObjectListField(model[field.key])
      const itemFields = field.itemFields ?? []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!
        for (const sub of itemFields) {
          if (itemFieldRequiredEmpty(sub, item[sub.key])) {
            const labelKey = pluginI18nKey(pluginId, sub.labelKey)
            const label = te(labelKey) ? t(labelKey) : sub.labelKey
            const reqKey = pluginI18nKey(pluginId, 'promptTemplateRequired')
            const req =
              te(reqKey) ? t(reqKey) : te('settings.plugins.promptRequired')
                ? t('settings.plugins.promptRequired')
                : 'Required'
            return `${label}: ${req}`
          }
        }
      }
      continue
    }
    if (field.required && !isNonEmptyText(model[field.key])) {
      const labelKey = pluginI18nKey(pluginId, field.labelKey)
      const label = te(labelKey) ? t(labelKey) : field.labelKey
      const reqKey = pluginI18nKey(pluginId, 'promptTemplateRequired')
      const req =
        te(reqKey) ? t(reqKey) : te('settings.plugins.promptRequired')
          ? t('settings.plugins.promptRequired')
          : 'Required'
      return `${label}: ${req}`
    }
  }
  return validateTraceKeeperBundleList(model, pluginId, t, te)
}

export function defaultTextForField(
  field: { defaultKey?: string },
  pluginId: string,
  _t: (key: string) => string,
  _te: (key: string) => boolean,
): string {
  if (!field.defaultKey) return ''
  if (hasPluginLocaleMessage(pluginId, field.defaultKey)) {
    return readPluginLocaleMessage(pluginId, field.defaultKey) ?? ''
  }
  const key = pluginI18nKey(pluginId, field.defaultKey)
  return _te(key) ? _t(key) : ''
}

export function hydratePluginSettingsDefaults(
  model: Record<string, unknown>,
  schema: PluginSettingsSchema | null | undefined,
  pluginId: string,
  t: (key: string) => string,
  te: (key: string) => boolean,
): void {
  if (!schema) return
  for (const field of schema.fields) {
    if (field.type === 'boolean' && model[field.key] === undefined) {
      model[field.key] = field.default === true
    }
    if (field.type === 'checkboxGroup' && !Array.isArray(model[field.key])) {
      if (Array.isArray(field.default)) {
        model[field.key] = field.default.filter(
          (x): x is string => typeof x === 'string',
        )
      } else if (field.default === '[]' || field.default === undefined) {
        model[field.key] = []
      } else {
        model[field.key] = parseCheckboxGroupField(field.default)
      }
    }
    if (
      field.type === 'text' &&
      field.widget === 'promptTemplate' &&
      field.defaultKey &&
      !String(model[field.key] ?? '').trim()
    ) {
      const text = defaultTextForField(field, pluginId, t, te)
      if (text) model[field.key] = text
    }
    if (field.type === 'objectList') {
      const items = parseObjectListField(model[field.key])
      let changed = false
      for (const item of items) {
        for (const sub of field.itemFields ?? []) {
          if (
            sub.widget === 'promptTemplate' &&
            sub.defaultKey &&
            !String(item[sub.key] ?? '').trim()
          ) {
            const text = defaultTextForField(sub, pluginId, t, te)
            if (text) {
              item[sub.key] = text
              changed = true
            }
          }
        }
      }
      if (changed) {
        model[field.key] = items
      }
    }
  }
}

export function newObjectListItem(
  itemFields: PluginSettingsItemFieldSchema[],
  pluginId: string,
  t: (key: string) => string,
  te: (key: string) => boolean,
  usedIds?: Set<string>,
): Record<string, unknown> {
  const reserved = new Set(usedIds ?? [])
  if (pluginId === TRACE_KEEPER_PLUGIN_ID) {
    reserved.add(TRACE_KEEPER_BUILTIN_BUNDLE_ID)
  }
  const item: Record<string, unknown> = {
    id: allocateShortId(reserved),
  }
  for (const sub of itemFields) {
    if (sub.type === 'boolean') {
      item[sub.key] = sub.default === true
    } else if (sub.type === 'integer' || sub.type === 'number') {
      item[sub.key] = typeof sub.default === 'number' ? sub.default : 0
    } else if (sub.type === 'enum') {
      item[sub.key] =
        typeof sub.default === 'string'
          ? sub.default
          : (sub.enum?.[0] ?? '')
    } else if (sub.defaultKey) {
      item[sub.key] = defaultTextForField(sub, pluginId, t, te)
    } else if (typeof sub.default === 'string') {
      item[sub.key] = sub.default
    } else {
      item[sub.key] = ''
    }
  }
  return item
}
