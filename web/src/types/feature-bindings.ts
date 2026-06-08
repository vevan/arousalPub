export const FEATURE_TYPES = [
  'chat',
  'rag_generate',
  'rerank',
] as const

export type FeatureType = (typeof FEATURE_TYPES)[number]

export interface FeatureBinding {
  id: string
  featureType: FeatureType
  featureRefId: string
  apiConfigId: string
  modelOverride?: string
  params?: Record<string, unknown>
  updatedAt: string
}

export interface FeatureBindingPutInput {
  id?: string
  featureType: FeatureType
  featureRefId: string
  apiConfigId: string
  modelOverride?: string
}
