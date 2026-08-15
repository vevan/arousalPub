import {
  formatHybridFtsSpec,
  type HybridFtsSettingsOverride,
} from './hybrid-fts-settings.js'
import { resolveAssetHybridFtsSettings } from './asset-hybrid-fts.js'
import { lorebookHasVectorEntries } from './lorebook-entry-utils.js'
import { readLorebookVectorProfile } from './lorebook-vector-profile.js'
import type { Lorebook } from './lorebook-types.js'
import { readKnowledgeChunksDocument } from './knowledge-base-file.js'

export interface AssetHybridFtsStatusFields {
  builtHybridFtsSpec: string | null
  hybridFtsStale: boolean
}

export async function lorebookHybridFtsStatus(
  lorebook: Lorebook,
): Promise<AssetHybridFtsStatusFields> {
  const [effective, profile] = await Promise.all([
    resolveAssetHybridFtsSettings(lorebook.hybridFts),
    readLorebookVectorProfile(lorebook.id),
  ])
  const builtHybridFtsSpec = profile?.hybridFtsSpec?.trim() || null
  // 无可索引条目：重建只会删索引，永远建不出戳记，不能报过期
  if (!lorebookHasVectorEntries(lorebook)) {
    return { builtHybridFtsSpec, hybridFtsStale: false }
  }
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
