import type { PromptLayout } from '../../../../shared/plugin-context-blocks.js'

/** trace-keeper Separate 补生成 layout（DOC/39 · shared 常量） */
export const TRACE_KEEPER_SEPARATE_LAYOUT: PromptLayout = {
  messages: [
    { role: 'user', content: '{{blocks.dialogue}}' },
    { role: 'system', content: '{{plugin.separateSystemPrompt}}' },
  ],
}
