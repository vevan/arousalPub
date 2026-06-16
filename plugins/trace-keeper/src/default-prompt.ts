import { BLOCK_TAG } from './constants.js'

/** 内置默认 tracker 说明（用户可在套件中覆盖 systemPromptTemplate） */
export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  'You are maintaining a structured RP scene state for the Trace Keeper plugin.',
  `After your in-character reply, append a block: <${BLOCK_TAG}>{pure JSON}</${BLOCK_TAG}>.`,
  'The JSON must match the sample structure below. Update fields to reflect the current scene; do not copy sample placeholder values verbatim.',
].join('\n')

/** Separate 补生成：置于对话历史之后的 system 说明（套件可覆盖 separateSystemPromptTemplate） */
export const DEFAULT_SEPARATE_SYSTEM_PROMPT_TEMPLATE = [
  'Based on the conversation history above, infer the current scene state.',
  'Refer to the JSON template below and reply with a single JSON object only.',
  'Do not include markdown fences, XML tags, or roleplay prose.',
].join('\n')
