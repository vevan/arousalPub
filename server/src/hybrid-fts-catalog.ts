import type { HybridFtsDictVariant, HybridFtsProfile } from './hybrid-fts-settings.js'
import { HYBRID_FTS_PROFILES, profileRequiresDict } from './hybrid-fts-settings.js'

export const JIEBA_REPO_URL = 'https://github.com/fxsjy/jieba'
const JIEBA_RAW_BASE = 'https://raw.githubusercontent.com/fxsjy/jieba/master'

export interface DictVariantCatalogEntry {
  id: HybridFtsDictVariant
  sourcePath: string
  downloadUrl: string
  sizeMbApprox: number
}

export interface TokenizerCatalogEntry {
  profile: HybridFtsProfile
  requiresDict: boolean
  dictFamily: string | null
  repoUrl: string | null
  variants: DictVariantCatalogEntry[]
}

const JIEBA_VARIANTS: DictVariantCatalogEntry[] = [
  {
    id: 'small',
    sourcePath: 'extra_dict/dict.txt.small',
    downloadUrl: `${JIEBA_RAW_BASE}/extra_dict/dict.txt.small`,
    sizeMbApprox: 1.5,
  },
  {
    id: 'default',
    sourcePath: 'jieba/dict.txt',
    downloadUrl: `${JIEBA_RAW_BASE}/jieba/dict.txt`,
    sizeMbApprox: 4.8,
  },
  {
    id: 'big',
    sourcePath: 'extra_dict/dict.txt.big',
    downloadUrl: `${JIEBA_RAW_BASE}/extra_dict/dict.txt.big`,
    sizeMbApprox: 8.2,
  },
]

export function getTokenizerCatalog(): TokenizerCatalogEntry[] {
  return HYBRID_FTS_PROFILES.map((profile) => catalogEntryForProfile(profile))
}

export function catalogEntryForProfile(profile: HybridFtsProfile): TokenizerCatalogEntry {
  if (profile === 'zh-jieba') {
    return {
      profile,
      requiresDict: true,
      dictFamily: 'jieba',
      repoUrl: JIEBA_REPO_URL,
      variants: [...JIEBA_VARIANTS],
    }
  }
  return {
    profile,
    requiresDict: false,
    dictFamily: null,
    repoUrl: null,
    variants: [],
  }
}

export function dictVariantEntryForProfile(
  profile: HybridFtsProfile,
  variant: HybridFtsDictVariant,
): DictVariantCatalogEntry | null {
  const entry = catalogEntryForProfile(profile)
  if (!profileRequiresDict(profile)) return null
  return entry.variants.find((v) => v.id === variant) ?? null
}
