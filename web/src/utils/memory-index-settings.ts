import { embeddingIndexMatchesIdentity } from './embedding-api-settings.js'
import {
  hybridFtsSpecsMatch,
  type HybridFtsSettings,
} from './hybrid-fts-settings.js'

export function memoryIndexMatchesEffectiveSettings(
  storedEmbedding: {
    embeddingProfile?: string | null
    embeddingModel?: string | null
    embeddingDimensions?: number | null
  },
  effectiveEmbedding: { embeddingProfile: string },
  storedHybridFtsSpec: string | null | undefined,
  globalHybridFtsSettings: HybridFtsSettings,
): boolean {
  return embeddingIndexMatchesIdentity(storedEmbedding, effectiveEmbedding) &&
    hybridFtsSpecsMatch(storedHybridFtsSpec, globalHybridFtsSettings)
}
