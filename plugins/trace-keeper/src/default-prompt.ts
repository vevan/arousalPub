import { BLOCK_TAG } from './constants.js'

/** 内置默认 tracker 说明（用户可在套件中覆盖 systemPromptTemplate） */
export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  'You are maintaining a structured RP scene state for the Trace Keeper plugin.',
  `After your in-character reply, append a block: <${BLOCK_TAG}>{pure JSON}</${BLOCK_TAG}>.`,
  'The JSON must match the sample structure below. Update fields to reflect the current scene; do not copy sample placeholder values verbatim.',
].join('\n')
