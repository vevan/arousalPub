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
  /**
   * 官方产物 SHA-256（小写十六进制）。本地导入按此门禁，
   * 改名的其他 major 版本或篡改包都无法混入。
   */
  sha256?: string
  /** 精确字节数，用于上传前快速拒绝 */
  sizeBytes?: number
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
  /** 官方 release 资产字节数 */
  sizeBytes: number
  /** 官方 release 资产 SHA-256（与 GitHub 发布摘要核对过） */
  sha256: string
  languageHint: 'ja' | 'ko' | 'zh'
  tags?: readonly string[]
}

const LINDERA_VARIANT_META: Record<LinderaDictKind, LinderaCatalogMeta> = {
  ipadic: {
    sizeMbApprox: 15.1,
    sizeBytes: 15_880_290,
    sha256: 'a40ce8820f1ce61d3257bf8ac14f999ae29abe78d4b81b4488594005ae863ee0',
    languageHint: 'ja',
    tags: ['recommended'],
  },
  'ipadic-neologd': {
    sizeMbApprox: 291,
    sizeBytes: 305_177_087,
    sha256: 'dec364a4db04d9a7bf325827c073b584d1f7b81d84f15ad5bb9be727436bd794',
    languageHint: 'ja',
    tags: ['large', 'advanced'],
  },
  unidic: {
    sizeMbApprox: 49.7,
    sizeBytes: 52_082_459,
    sha256: 'dde2e3080799ab69e270107c9ea7ce865456c4099a5545bf92d00ebe5c7c3e00',
    languageHint: 'ja',
  },
  'ko-dic': {
    sizeMbApprox: 34.2,
    sizeBytes: 35_827_424,
    sha256: 'c11bbde53692662b3941a6b8c24c7b81bac90a518c5994e8418b10843249fbf0',
    languageHint: 'ko',
  },
  'cc-cedict': {
    sizeMbApprox: 10,
    sizeBytes: 10_522_647,
    sha256: '2c9a590ab48f200e56363d43c3eea31ceab93b583509896771bec509be108fd3',
    languageHint: 'zh',
    tags: ['eval'],
  },
  jieba: {
    sizeMbApprox: 23.7,
    sizeBytes: 24_869_842,
    sha256: '6eab37326949d8dd1773967e3add5573c18b54c25d80e1229fad68dde48bf842',
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
      sizeBytes: meta.sizeBytes,
      sha256: meta.sha256,
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
