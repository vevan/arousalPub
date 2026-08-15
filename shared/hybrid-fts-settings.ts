/** Hybrid 检索 BM25 FTS 分词配置（memory / lore / knowledge） */

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

export type HybridFtsSettingsInput = {
  profile?: unknown
  dictVariant?: unknown
}

export type HybridFtsSettingsOverride = HybridFtsSettings | null | undefined

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

export function isHybridFtsProfile(raw: unknown): raw is HybridFtsProfile {
  return typeof raw === 'string'
    && (HYBRID_FTS_PROFILES as readonly string[]).includes(raw)
}

export function normalizeHybridFtsProfile(raw: unknown): HybridFtsProfile {
  return isHybridFtsProfile(raw) ? raw : HYBRID_FTS_SETTINGS_DEFAULTS.profile
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
  raw?: HybridFtsSettingsInput | null,
): HybridFtsSettings {
  const profile = normalizeHybridFtsProfile(raw?.profile)
  const dictVariant = profileRequiresDict(profile)
    ? normalizeHybridFtsDictVariant(raw?.dictVariant, profile)
    : null
  return { profile, dictVariant }
}

/**
 * 严格解析用户提交的完整设置。
 * 返回 null 表示输入不是合法完整对象；不会回落到默认 profile/variant。
 */
export function parseHybridFtsSettingsStrict(raw: unknown): HybridFtsSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const input = raw as Record<string, unknown>
  if (!isHybridFtsProfile(input.profile)) return null
  const allowedKeys = new Set(['profile', 'dictVariant'])
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return null
  const profile = input.profile
  if (!profileRequiresDict(profile)) {
    if (input.dictVariant !== undefined && input.dictVariant !== null) return null
    return { profile, dictVariant: null }
  }
  const variants = dictVariantsForProfile(profile)
  if (
    typeof input.dictVariant !== 'string'
    || !(variants as readonly string[]).includes(input.dictVariant)
  ) {
    return null
  }
  return { profile, dictVariant: input.dictVariant as HybridFtsDictVariant }
}

/** override 为 null/缺省时继承全局；对象存在时整包覆盖，不逐字段 merge。 */
export function resolveEffectiveHybridFtsSettings(
  global: HybridFtsSettings,
  override?: HybridFtsSettingsOverride,
): HybridFtsSettings {
  return normalizeHybridFtsSettings(override == null ? global : override)
}

export function formatHybridFtsSpec(settings: HybridFtsSettings): string {
  const normalized = normalizeHybridFtsSettings(settings)
  if (profileRequiresDict(normalized.profile) && normalized.dictVariant) {
    return `${normalized.profile}:${normalized.dictVariant}`
  }
  return normalized.profile
}

export function parseHybridFtsSpec(raw: string | null | undefined): HybridFtsSettings {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return { ...HYBRID_FTS_SETTINGS_DEFAULTS }
  const colon = value.indexOf(':')
  if (colon < 0) {
    return normalizeHybridFtsSettings({ profile: normalizeHybridFtsProfile(value) })
  }
  const profile = normalizeHybridFtsProfile(value.slice(0, colon))
  const dictVariant = normalizeHybridFtsDictVariant(value.slice(colon + 1), profile)
  return normalizeHybridFtsSettings({ profile, dictVariant })
}

export function hybridFtsSpecsMatch(
  stored: string | null | undefined,
  effective: HybridFtsSettings,
): boolean {
  const storedSpec = typeof stored === 'string' && stored.trim() ? stored.trim() : null
  if (!storedSpec) {
    return formatHybridFtsSpec(effective)
      === formatHybridFtsSpec(HYBRID_FTS_SETTINGS_DEFAULTS)
  }
  return storedSpec === formatHybridFtsSpec(effective)
}
