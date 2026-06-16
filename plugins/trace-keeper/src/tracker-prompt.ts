import type { TraceBundle } from './constants.js'
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from './default-prompt.js'

type LiveStateEntry = { state: Record<string, unknown>; turnOrdinal: number }

function formatLiveStateJson(
  liveStates: LiveStateEntry[],
  sampleState: Record<string, unknown>,
): string {
  if (liveStates.length === 0) {
    return JSON.stringify(sampleState, null, 2)
  }
  if (liveStates.length === 1) {
    return JSON.stringify(liveStates[0]!.state, null, 2)
  }
  return liveStates
    .map(
      (entry) =>
        `/* turn ${entry.turnOrdinal} */\n${JSON.stringify(entry.state, null, 2)}`,
    )
    .join('\n\n')
}

export function buildTrackerSystemPrompt(
  bundle: TraceBundle,
  liveStates: LiveStateEntry[],
): string {
  const prefix =
    bundle.systemPromptTemplate?.trim() || DEFAULT_SYSTEM_PROMPT_TEMPLATE
  const sampleJson = JSON.stringify(bundle.sampleState, null, 2)
  const liveJson = formatLiveStateJson(liveStates, bundle.sampleState)
  const liveHeader =
    liveStates.length > 1
      ? '--- current live state history (newest last) ---'
      : '--- current live state (update from this) ---'
  return [
    prefix,
    '--- sample structure (reference only) ---',
    sampleJson,
    liveHeader,
    liveJson,
  ].join('\n')
}
