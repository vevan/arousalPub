import type { ResolvedEmbeddingCredentials } from './embedding-credential-resolve.js'

/**
 * 旧索引缺少 API 端点身份，无法证明与当前向量空间兼容。
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
  return `legacy-api:${legacyModel}:${dimensions ?? 'default'}`
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
