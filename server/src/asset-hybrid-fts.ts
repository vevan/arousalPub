import {
  resolveEffectiveHybridFtsSettings,
  type HybridFtsSettings,
  type HybridFtsSettingsOverride,
} from './hybrid-fts-settings.js'
import { prepareHybridFtsSettings } from './hybrid-fts-dict.js'
import { readGlobalHybridFtsSettings } from './user-preferences-file.js'
import { getCurrentUserId } from './user-context.js'

export async function resolveAssetHybridFtsSettings(
  override?: HybridFtsSettingsOverride,
): Promise<HybridFtsSettings> {
  return resolveEffectiveHybridFtsSettings(
    await readGlobalHybridFtsSettings(),
    override,
  )
}

/** 需词典的资产设置必须在资产 JSON 写盘前准备成功。 */
export async function prepareAssetHybridFtsSettings(
  override?: HybridFtsSettingsOverride,
): Promise<HybridFtsSettings> {
  const effective = await resolveAssetHybridFtsSettings(override)
  await prepareHybridFtsSettings(effective, getCurrentUserId())
  return effective
}
