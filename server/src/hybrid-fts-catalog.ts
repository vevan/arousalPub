import type {
  HybridFtsDictVariant,
  HybridFtsProfile,
  LinderaDictKind,
} from './hybrid-fts-settings.js'
import {
  HYBRID_FTS_PROFILES,
  LINDERA_DICT_KINDS,
  profileRequiresDict,
} from './hybrid-fts-settings.js'

export const JIEBA_REPO_URL = 'https://github.com/fxsjy/jieba'
const JIEBA_RAW_BASE = 'https://raw.githubusercontent.com/fxsjy/jieba/master'

/** 与当前 `@lancedb/lancedb` 内嵌 lindera crate 对齐；升级 Lance 后须复核 */
export const LINDERA_DICT_RELEASE_TAG = 'v3.0.7'
export const LINDERA_REPO_URL = 'https://github.com/lindera/lindera'

const LINDERA_RELEASE_BASE = `https://github.com/lindera/lindera/releases/download/${LINDERA_DICT_RELEASE_TAG}`

export type DictArtifactKind = 'file' | 'zip'

export interface DictVariantCatalogEntry {
  id: HybridFtsDictVariant
  sourcePath: string
  downloadUrl: string
  sizeMbApprox: number
  artifactKind: DictArtifactKind
  /** Lindera：语言提示（ja / ko / zh） */
  languageHint?: 'ja' | 'ko' | 'zh'
  /** UI：大体积 / 评估用等 */
  tags?: readonly string[]
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
    artifactKind: 'file',
  },
  {
    id: 'default',
    sourcePath: 'jieba/dict.txt',
    downloadUrl: `${JIEBA_RAW_BASE}/jieba/dict.txt`,
    sizeMbApprox: 4.8,
    artifactKind: 'file',
  },
  {
    id: 'big',
    sourcePath: 'extra_dict/dict.txt.big',
    downloadUrl: `${JIEBA_RAW_BASE}/extra_dict/dict.txt.big`,
    sizeMbApprox: 8.2,
    artifactKind: 'file',
  },
]

type LinderaCatalogMeta = {
  sizeMbApprox: number
  languageHint: 'ja' | 'ko' | 'zh'
  tags?: readonly string[]
}

const LINDERA_VARIANT_META: Record<LinderaDictKind, LinderaCatalogMeta> = {
  ipadic: {
    sizeMbApprox: 15.1,
    languageHint: 'ja',
    tags: ['recommended'],
  },
  'ipadic-neologd': {
    sizeMbApprox: 291,
    languageHint: 'ja',
    tags: ['large', 'advanced'],
  },
  unidic: {
    sizeMbApprox: 49.7,
    languageHint: 'ja',
  },
  'ko-dic': {
    sizeMbApprox: 34.2,
    languageHint: 'ko',
  },
  'cc-cedict': {
    sizeMbApprox: 10,
    languageHint: 'zh',
    tags: ['eval'],
  },
  jieba: {
    sizeMbApprox: 23.7,
    languageHint: 'zh',
    tags: ['eval'],
  },
}

function linderaZipName(kind: LinderaDictKind): string {
  return `lindera-${kind}-${LINDERA_DICT_RELEASE_TAG.replace(/^v/, '')}.zip`
}

function linderaVariants(): DictVariantCatalogEntry[] {
  return LINDERA_DICT_KINDS.map((id) => {
    const meta = LINDERA_VARIANT_META[id]
    const zip = linderaZipName(id)
    return {
      id,
      sourcePath: zip,
      downloadUrl: `${LINDERA_RELEASE_BASE}/${zip}`,
      sizeMbApprox: meta.sizeMbApprox,
      artifactKind: 'zip' as const,
      languageHint: meta.languageHint,
      tags: meta.tags,
    }
  })
}

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
  if (profile === 'lindera') {
    return {
      profile,
      requiresDict: true,
      dictFamily: 'lindera',
      repoUrl: LINDERA_REPO_URL,
      variants: linderaVariants(),
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
