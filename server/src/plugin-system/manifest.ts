import { readFile } from 'node:fs/promises'
import { getInstalledPluginManifestPath } from './paths.js'
import { normalizeInjectionOrderSlots } from '../shared/post-user-injection-order.js'
import { normalizeSettingsSchema } from './settings-schema.js'
import type { PluginManifest } from './types.js'

const ACTION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
/** OpenAI tools.function.name：^[a-zA-Z0-9_-]{1,64}$（禁止点号） */
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/
/** DOC/53 §6.3 nodeTypes.type：允许点号前缀 */
const NODE_TYPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

function normalizeServerActions(
  raw: unknown,
): PluginManifest['serverActions'] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: NonNullable<PluginManifest['serverActions']> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const name =
      typeof (item as { name?: unknown }).name === 'string'
        ? (item as { name: string }).name.trim()
        : ''
    if (!name || !ACTION_NAME_RE.test(name)) continue
    const permsRaw = (item as { permissions?: unknown }).permissions
    const permissions = Array.isArray(permsRaw)
      ? permsRaw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    if (permissions.length === 0) continue
    out.push({ name, permissions })
  }
  return out.length ? out : undefined
}

function normalizeManifestTools(
  raw: unknown,
): PluginManifest['tools'] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: NonNullable<PluginManifest['tools']> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const name =
      typeof (item as { name?: unknown }).name === 'string'
        ? (item as { name: string }).name.trim()
        : ''
    if (!name || !TOOL_NAME_RE.test(name)) continue
    const permsRaw = (item as { permissions?: unknown }).permissions
    const permissions = Array.isArray(permsRaw)
      ? permsRaw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    if (permissions.length === 0) continue
    const description =
      typeof (item as { description?: unknown }).description === 'string'
        ? (item as { description: string }).description.trim()
        : undefined
    const uiTitleKey =
      typeof (item as { uiTitleKey?: unknown }).uiTitleKey === 'string'
        ? (item as { uiTitleKey: string }).uiTitleKey.trim()
        : undefined
    const uiDescriptionKey =
      typeof (item as { uiDescriptionKey?: unknown }).uiDescriptionKey ===
      'string'
        ? (item as { uiDescriptionKey: string }).uiDescriptionKey.trim()
        : undefined
    const parametersRaw = (item as { parameters?: unknown }).parameters
    const parameters =
      parametersRaw &&
      typeof parametersRaw === 'object' &&
      !Array.isArray(parametersRaw)
        ? (parametersRaw as Record<string, unknown>)
        : undefined
    const phaseRaw = (item as { phase?: unknown }).phase
    const phase =
      phaseRaw === 'read' || phaseRaw === 'write' ? phaseRaw : undefined
    const maxRaw = (item as { maxCallsPerTurn?: unknown }).maxCallsPerTurn
    const maxCallsPerTurn =
      typeof maxRaw === 'number' &&
      Number.isFinite(maxRaw) &&
      Math.round(maxRaw) >= 1
        ? Math.min(32, Math.round(maxRaw))
        : undefined
    out.push({
      name,
      permissions,
      ...(description ? { description } : {}),
      ...(uiTitleKey ? { uiTitleKey } : {}),
      ...(uiDescriptionKey ? { uiDescriptionKey } : {}),
      ...(parameters ? { parameters } : {}),
      ...(phase ? { phase } : {}),
      ...(maxCallsPerTurn !== undefined ? { maxCallsPerTurn } : {}),
    })
  }
  return out.length ? out : undefined
}

function normalizeManifestNodeTypes(
  raw: unknown,
): PluginManifest['nodeTypes'] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: NonNullable<PluginManifest['nodeTypes']> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const type =
      typeof (item as { type?: unknown }).type === 'string'
        ? (item as { type: string }).type.trim()
        : ''
    if (!type || !NODE_TYPE_RE.test(type)) continue
    const permsRaw = (item as { permissions?: unknown }).permissions
    const permissions = Array.isArray(permsRaw)
      ? permsRaw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    if (permissions.length === 0) continue
    const versionRaw = (item as { version?: unknown }).version
    const version =
      typeof versionRaw === 'number' &&
      Number.isFinite(versionRaw) &&
      Math.round(versionRaw) >= 1
        ? Math.round(versionRaw)
        : 1
    const title =
      typeof (item as { title?: unknown }).title === 'string'
        ? (item as { title: string }).title.trim()
        : undefined
    const titleKey =
      typeof (item as { titleKey?: unknown }).titleKey === 'string'
        ? (item as { titleKey: string }).titleKey.trim()
        : undefined
    const description =
      typeof (item as { description?: unknown }).description === 'string'
        ? (item as { description: string }).description.trim()
        : undefined
    const descriptionKey =
      typeof (item as { descriptionKey?: unknown }).descriptionKey === 'string'
        ? (item as { descriptionKey: string }).descriptionKey.trim()
        : undefined
    const inputsRaw = (item as { inputs?: unknown }).inputs
    const inputs = Array.isArray(inputsRaw)
      ? inputsRaw
          .filter(
            (x): x is { name: string; valueType?: string } =>
              !!x &&
              typeof x === 'object' &&
              typeof (x as { name?: unknown }).name === 'string',
          )
          .map((x) => ({
            name: x.name.trim(),
            ...(typeof x.valueType === 'string'
              ? { valueType: x.valueType.trim() }
              : {}),
          }))
          .filter((x) => x.name)
      : undefined
    const outputsRaw = (item as { outputs?: unknown }).outputs
    const outputs = Array.isArray(outputsRaw)
      ? outputsRaw
          .filter(
            (x): x is { name: string; valueType?: string } =>
              !!x &&
              typeof x === 'object' &&
              typeof (x as { name?: unknown }).name === 'string',
          )
          .map((x) => ({
            name: x.name.trim(),
            ...(typeof x.valueType === 'string'
              ? { valueType: x.valueType.trim() }
              : {}),
          }))
          .filter((x) => x.name)
      : undefined
    out.push({
      type,
      version,
      permissions,
      ...(title ? { title } : {}),
      ...(titleKey ? { titleKey } : {}),
      ...(description ? { description } : {}),
      ...(descriptionKey ? { descriptionKey } : {}),
      ...(inputs?.length ? { inputs } : {}),
      ...(outputs?.length ? { outputs } : {}),
    })
  }
  return out.length ? out : undefined
}

export async function readPluginManifest(
  pluginId: string,
): Promise<PluginManifest | null> {
  const id = pluginId.trim()
  if (!id) return null
  try {
    const raw = await readFile(getInstalledPluginManifestPath(id), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const m = parsed as Partial<PluginManifest>
    if (typeof m.id !== 'string' || !m.id.trim()) return null
    if (typeof m.name !== 'string' || !m.name.trim()) return null
    if (typeof m.version !== 'string' || !m.version.trim()) return null
    const settingsSchema = normalizeSettingsSchema(m.settingsSchema)
    const conversationSettingsSchema = normalizeSettingsSchema(
      m.conversationSettingsSchema,
    )
    return {
      id: m.id.trim(),
      name: m.name.trim(),
      version: m.version.trim(),
      permissions: Array.isArray(m.permissions)
        ? m.permissions.filter((x): x is string => typeof x === 'string')
        : undefined,
      hooks: Array.isArray(m.hooks)
        ? m.hooks.filter((x): x is string => typeof x === 'string')
        : undefined,
      memory:
        m.memory && typeof m.memory === 'object'
          ? {
              stripBlockTags: Array.isArray(
                (m.memory as { stripBlockTags?: unknown }).stripBlockTags,
              )
                ? (
                    m.memory as { stripBlockTags: unknown[] }
                  ).stripBlockTags.filter(
                    (x): x is string => typeof x === 'string' && x.trim().length > 0,
                  )
                : undefined,
            }
          : undefined,
      turnPlugins:
        m.turnPlugins && typeof m.turnPlugins === 'object'
          ? {
              mergeMode:
                (m.turnPlugins as { mergeMode?: unknown }).mergeMode ===
                'receive-scoped'
                  ? 'receive-scoped'
                  : (m.turnPlugins as { mergeMode?: unknown }).mergeMode ===
                      'replace-by-plugin-id'
                    ? 'replace-by-plugin-id'
                    : undefined,
              receiveIdKey:
                typeof (m.turnPlugins as { receiveIdKey?: unknown }).receiveIdKey ===
                'string'
                  ? (m.turnPlugins as { receiveIdKey: string }).receiveIdKey.trim()
                  : undefined,
            }
          : undefined,
      assembleInjection:
        m.assembleInjection && typeof m.assembleInjection === 'object'
          ? {
              slots: normalizeInjectionOrderSlots(
                (m.assembleInjection as { slots?: unknown }).slots,
              ),
              slotSettingsKeys: (() => {
                const raw = (m.assembleInjection as { slotSettingsKeys?: unknown })
                  .slotSettingsKeys
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                  return undefined
                }
                const out: Record<string, string> = {}
                for (const [slotKey, settingsKey] of Object.entries(
                  raw as Record<string, unknown>,
                )) {
                  const sk = slotKey.trim()
                  const fk =
                    typeof settingsKey === 'string' ? settingsKey.trim() : ''
                  if (!sk || !fk || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(fk)) {
                    continue
                  }
                  out[sk] = fk
                }
                return Object.keys(out).length > 0 ? out : undefined
              })(),
            }
          : undefined,
      serverActions: normalizeServerActions(
        (m as { serverActions?: unknown }).serverActions,
      ),
      tools: normalizeManifestTools((m as { tools?: unknown }).tools),
      nodeTypes: normalizeManifestNodeTypes(
        (m as { nodeTypes?: unknown }).nodeTypes,
      ),
      lifecycle:
        m.lifecycle && typeof m.lifecycle === 'object'
          ? {
              onCharacterPrimaryChanged:
                (m.lifecycle as { onCharacterPrimaryChanged?: unknown })
                  .onCharacterPrimaryChanged === true,
            }
          : undefined,
      ui:
        m.ui && typeof m.ui === 'object'
          ? {
              slots: Array.isArray((m.ui as { slots?: unknown }).slots)
                ? (m.ui as { slots: unknown[] }).slots.filter(
                    (s): s is { name: string; entry?: string } =>
                      !!s &&
                      typeof s === 'object' &&
                      typeof (s as { name?: unknown }).name === 'string',
                  )
                : undefined,
              eagerOnRoutes: Array.isArray(
                (m.ui as { eagerOnRoutes?: unknown }).eagerOnRoutes,
              )
                ? (m.ui as { eagerOnRoutes: unknown[] }).eagerOnRoutes
                    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
                    .map((x) => x.trim())
                : undefined,
            }
          : undefined,
      connection: m.connection,
      settingsSchema: settingsSchema ?? undefined,
      conversationSettingsSchema: conversationSettingsSchema ?? undefined,
    }
  } catch {
    return null
  }
}
