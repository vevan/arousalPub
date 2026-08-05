export interface StPromptOrderItem {
  identifier: string
  enabled?: boolean
}

export interface StPrompt {
  identifier: string
  name?: string
  role?: string
  content?: string
  marker?: boolean
  system_prompt?: boolean
  forbid_overrides?: boolean
  injection_position?: number
  injection_depth?: number
  injection_order?: number
  injection_trigger?: string[]
}

export interface StPresetJson {
  prompts?: StPrompt[]
  prompt_order?: Array<{
    character_id?: number
    order?: StPromptOrderItem[]
  }>
  name?: string
}
