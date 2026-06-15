/** Hybrid 检索 BM25 FTS 分词配置（memory / lore vector） */

export type HybridFtsProfile = 'zh-ngram' | 'en' | 'zh-jieba'

export type HybridFtsDictVariant = 'small' | 'default' | 'big'

export interface HybridFtsSettings {
  profile: HybridFtsProfile
  /** 需词典的分词器所选规格；缺省为 default */
  dictVariant?: HybridFtsDictVariant | null
}

export const HYBRID_FTS_PROFILES: readonly HybridFtsProfile[] = [
  'zh-ngram',
  'en',
  'zh-jieba',
]

export const HYBRID_FTS_DICT_VARIANTS: readonly HybridFtsDictVariant[] = [
  'small',
  'default',
  'big',
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

export function normalizeHybridFtsDictVariant(raw: unknown): HybridFtsDictVariant {
  if (
    typeof raw === 'string' &&
    (HYBRID_FTS_DICT_VARIANTS as readonly string[]).includes(raw)
  ) {
    return raw as HybridFtsDictVariant
  }
  return 'default'
}

export function profileRequiresDict(profile: HybridFtsProfile): boolean {
  return profile === 'zh-jieba'
}

export type HybridFtsSettingsInput = {
  profile?: unknown
  dictVariant?: unknown
}

export function normalizeHybridFtsSettings(
  raw?: HybridFtsSettingsInput | null,
): HybridFtsSettings {
  const profile = normalizeHybridFtsProfile(raw?.profile)
  const dictVariant = profileRequiresDict(profile)
    ? normalizeHybridFtsDictVariant(raw?.dictVariant)
    : null
  return { profile, dictVariant }
}

/** 会话 index / FTS stamp 用复合键，如 zh-jieba:default */
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
  const dictVariant = normalizeHybridFtsDictVariant(s.slice(colon + 1))
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
