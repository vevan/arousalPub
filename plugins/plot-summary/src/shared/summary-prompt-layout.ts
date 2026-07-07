import type { PromptLayout } from '../../../../shared/plugin-context-blocks.js'

/** Historian 二次 LLM layout（DOC/39 · shared 常量） */
export const PLOT_SUMMARY_COMPLETE_LAYOUT: PromptLayout = {
  messages: [
    { role: 'system', content: '{{blocks.reference}}' },
    { role: 'user', content: '{{blocks.history}}' },
    { role: 'system', content: '{{plugin.systemPromptTemplate}}' },
  ],
}
