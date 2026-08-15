import {
  formatHybridFtsSpec,
  type HybridFtsSettingsOverride,
} from './hybrid-fts-settings.js'
import { resolveAssetHybridFtsSettings } from './asset-hybrid-fts.js'
import { readLorebookVectorProfile } from './lorebook-vector-profile.js'
import { readKnowledgeChunksDocument } from './knowledge-base-file.js'

export interface AssetHybridFtsStatusFields {
  builtHybridFtsSpec: string | null
  hybridFtsStale: boolean
}

export async function lorebookHybridFtsStatus(
  lorebookId: string,
  override?: HybridFtsSettingsOverride,
): Promise<AssetHybridFtsStatusFields> {
  const [effective, profile] = await Promise.all([
    resolveAssetHybridFtsSettings(override),
    readLorebookVectorProfile(lorebookId),
  ])
  const builtHybridFtsSpec = profile?.hybridFtsSpec?.trim() || null
  return {
    builtHybridFtsSpec,
    hybridFtsStale:
      !builtHybridFtsSpec || builtHybridFtsSpec !== formatHybridFtsSpec(effective),
  }
}

export async function knowledgeHybridFtsStatus(
  kbId: string,
  override?: HybridFtsSettingsOverride,
): Promise<AssetHybridFtsStatusFields> {
  const [effective, chunks] = await Promise.all([
    resolveAssetHybridFtsSettings(override),
    readKnowledgeChunksDocument(kbId),
  ])
  const builtHybridFtsSpec = chunks?.hybridFtsSpec?.trim() || null
  return {
    builtHybridFtsSpec,
    hybridFtsStale:
      !builtHybridFtsSpec || builtHybridFtsSpec !== formatHybridFtsSpec(effective),
  }
}
