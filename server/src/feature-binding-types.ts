/**
 * Feature-binding type surface without resolve / api-config imports.
 * Keeps chat-turn-accessors free of the api-config-references cycle.
 */

export const FEATURE_TYPES = ['chat', 'rag_generate', 'rerank'] as const
export type FeatureType = (typeof FEATURE_TYPES)[number]

export type ResolvedFeatureSource =
  | 'conversation'
  | 'global'
  | 'plugin_settings'

export type ResolvedFeatureType = FeatureType | 'plugin'

export interface ResolvedFeatureBinding {
  featureType: ResolvedFeatureType
  featureRefId: string
  pluginId?: string
  apiConfigId: string
  modelOverride?: string
  source: ResolvedFeatureSource
}

/** 落盘 / 组装预览审计字段（不含 preset 与密钥） */
export interface ResolvedFeatureAudit {
  featureType: ResolvedFeatureType
  apiConfigId: string
  source: ResolvedFeatureSource
  pluginId?: string
  model?: string
}
