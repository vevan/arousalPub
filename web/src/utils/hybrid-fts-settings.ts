/** Hybrid 检索 BM25 FTS 分词配置（memory / lore vector） */

export type HybridFtsProfile = 'zh-ngram' | 'en' | 'zh-jieba' | 'lindera'

export type JiebaDictVariant = 'small' | 'default' | 'big'

export type LinderaDictKind =
  | 'ipadic'
  | 'ipadic-neologd'
  | 'unidic'
  | 'ko-dic'
  | 'cc-cedict'
  | 'jieba'

/** jieba 规格与 Lindera 语言包共用 dictVariant 字段 */
export type HybridFtsDictVariant = JiebaDictVariant | LinderaDictKind

export interface HybridFtsSettings {
  profile: HybridFtsProfile
  /** 需词典的分词器所选规格；缺省依 profile */
  dictVariant?: HybridFtsDictVariant | null
}

export const HYBRID_FTS_PROFILES: readonly HybridFtsProfile[] = [
  'zh-ngram',
  'en',
  'zh-jieba',
  'lindera',
]

export const JIEBA_DICT_VARIANTS: readonly JiebaDictVariant[] = [
  'small',
  'default',
  'big',
]

export const LINDERA_DICT_KINDS: readonly LinderaDictKind[] = [
  'ipadic',
  'ipadic-neologd',
  'unidic',
  'ko-dic',
  'cc-cedict',
  'jieba',
]

export const HYBRID_FTS_SETTINGS_DEFAULTS: HybridFtsSettings = {
  profile: 'zh-ngram',
  dictVariant: null,
}

export function normalizeHybridFtsProfile(raw: unknown): HybridFtsProfile {
  if (typeof raw === 'string' && (HYBRID_FTS_PROFILES as readonly string[]).includes(raw)) {
    return raw as HybridFtsProfile
  }
  return HYBRID_FTS_SETTINGS_DEFAULTS.profile
}

export function profileRequiresDict(profile: HybridFtsProfile): boolean {
  return profile === 'zh-jieba' || profile === 'lindera'
}

export function dictVariantsForProfile(
  profile: HybridFtsProfile,
): readonly HybridFtsDictVariant[] {
  if (profile === 'zh-jieba') return JIEBA_DICT_VARIANTS
  if (profile === 'lindera') return LINDERA_DICT_KINDS
  return []
}

export function defaultDictVariantForProfile(
  profile: HybridFtsProfile,
): HybridFtsDictVariant | null {
  if (profile === 'zh-jieba') return 'default'
  if (profile === 'lindera') return 'ipadic'
  return null
}

/**
 * 按 profile 规范化词典规格。
 * 未知值回落到该 profile 默认。
 */
export function normalizeHybridFtsDictVariant(
  raw: unknown,
  profile: HybridFtsProfile,
): HybridFtsDictVariant {
  const allowed = dictVariantsForProfile(profile)
  const fallback = defaultDictVariantForProfile(profile) ?? 'default'
  if (allowed.length === 0) return fallback
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) {
    return raw as HybridFtsDictVariant
  }
  return fallback
}

export function normalizeHybridFtsSettings(
  raw?: Partial<HybridFtsSettings> | null,
): HybridFtsSettings {
  const profile = normalizeHybridFtsProfile(raw?.profile)
  const dictVariant = profileRequiresDict(profile)
    ? normalizeHybridFtsDictVariant(raw?.dictVariant, profile)
    : null
  return { profile, dictVariant }
}

export function formatHybridFtsSpec(settings: HybridFtsSettings): string {
  const n = normalizeHybridFtsSettings(settings)
  if (profileRequiresDict(n.profile) && n.dictVariant) {
    return `${n.profile}:${n.dictVariant}`
  }
  return n.profile
}

export function parseHybridFtsSpec(raw: string | null | undefined): HybridFtsSettings {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { ...HYBRID_FTS_SETTINGS_DEFAULTS }
  const colon = s.indexOf(':')
  if (colon < 0) {
    return normalizeHybridFtsSettings({ profile: normalizeHybridFtsProfile(s) })
  }
  const profile = normalizeHybridFtsProfile(s.slice(0, colon))
  const dictVariant = normalizeHybridFtsDictVariant(s.slice(colon + 1), profile)
  return normalizeHybridFtsSettings({ profile, dictVariant })
}

export function hybridFtsSpecsMatch(
  stored: string | null | undefined,
  global: HybridFtsSettings,
): boolean {
  const storedSpec = typeof stored === 'string' && stored.trim() ? stored.trim() : null
  if (!storedSpec) {
    return formatHybridFtsSpec(global) === formatHybridFtsSpec(HYBRID_FTS_SETTINGS_DEFAULTS)
  }
  return storedSpec === formatHybridFtsSpec(global)
}
