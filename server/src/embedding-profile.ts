import { embeddingApiProfile, type ResolvedEmbeddingCredentials } from './embedding-credential-resolve.js'

/**
 * 旧索引仅记录 model/dimensions；只能迁移为 API profile，绝不猜测为 builtin。
 */
export function storedEmbeddingProfile(
  profile: string | null | undefined,
  model: string | null | undefined,
  dimensions: number | null | undefined,
): string | null {
  const explicit = profile?.trim()
  if (explicit) return explicit
  const legacyModel = model?.trim()
  if (!legacyModel || legacyModel.startsWith('builtin:')) return null
  return embeddingApiProfile(legacyModel, dimensions ?? null)
}

export function embeddingIndexMatchesProvider(
  stored: {
    embeddingProfile?: string | null
    embeddingModel?: string | null
    embeddingDimensions?: number | null
  },
  active: ResolvedEmbeddingCredentials,
): boolean {
  return storedEmbeddingProfile(
    stored.embeddingProfile,
    stored.embeddingModel,
    stored.embeddingDimensions,
  ) === active.embeddingProfile
}
