import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  normalizeInjectionOrderSlots,
  type AssembleInjectionOrderSlots,
} from '../shared/post-user-injection-order.js'
import { readBundledPluginCatalog } from './bundled-registry.js'
import { getGlobalPluginsDir } from './paths.js'
import { readPluginManifest } from './manifest.js'
import type { PluginManifest } from './types.js'

export type AssembleInjectionOrderPolicy = {
  slots: AssembleInjectionOrderSlots
  slotSettingsKeys: Record<string, string>
}

const SLOT_SETTINGS_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

function normalizeSlotSettingsKeys(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [slotKey, settingsKey] of Object.entries(raw as Record<string, unknown>)) {
    const sk = slotKey.trim()
    const fk =
      typeof settingsKey === 'string' ? settingsKey.trim() : ''
    if (!sk || !fk || !SLOT_SETTINGS_KEY_RE.test(fk)) continue
    out[sk] = fk
  }
  return out
}

function policyFromManifest(manifest: PluginManifest): AssembleInjectionOrderPolicy {
  return {
    slots: normalizeInjectionOrderSlots(manifest.assembleInjection?.slots) ?? {},
    slotSettingsKeys: normalizeSlotSettingsKeys(
      manifest.assembleInjection?.slotSettingsKeys,
    ),
  }
}

let policyByPluginId = new Map<string, AssembleInjectionOrderPolicy>()

async function listInstalledPluginIds(): Promise<string[]> {
  const root = getGlobalPluginsDir()
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true })
  const ids: string[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const manifestPath = path.join(root, ent.name, 'manifest.json')
    if (existsSync(manifestPath)) ids.push(ent.name)
  }
  return ids
}

export async function refreshAssembleInjectionOrderPolicies(): Promise<void> {
  const catalog = await readBundledPluginCatalog()
  const pluginIds = new Set<string>(catalog.plugins.map((p) => p.id))
  for (const id of await listInstalledPluginIds()) {
    pluginIds.add(id)
  }

  const next = new Map<string, AssembleInjectionOrderPolicy>()
  for (const id of pluginIds) {
    const manifest = await readPluginManifest(id)
    if (!manifest) continue
    next.set(id, policyFromManifest(manifest))
  }
  policyByPluginId = next
}

export function getAssembleInjectionOrderPolicy(
  pluginId: string,
): AssembleInjectionOrderPolicy {
  return policyByPluginId.get(pluginId) ?? { slots: {}, slotSettingsKeys: {} }
}

/** @deprecated 使用 resolveEffectiveAssembleInjectionOrderSlots */
export function getAssembleInjectionOrderSlots(
  pluginId: string,
): AssembleInjectionOrderSlots {
  return getAssembleInjectionOrderPolicy(pluginId).slots
}

export function __setAssembleInjectionOrderSlotsForTest(
  pluginId: string,
  slots: AssembleInjectionOrderSlots,
): void {
  policyByPluginId.set(pluginId, {
    slots,
    slotSettingsKeys: {},
  })
}

export function __setAssembleInjectionOrderPolicyForTest(
  pluginId: string,
  policy: AssembleInjectionOrderPolicy,
): void {
  policyByPluginId.set(pluginId, policy)
}

export function __resetAssembleInjectionOrderPoliciesForTest(): void {
  policyByPluginId = new Map()
}
