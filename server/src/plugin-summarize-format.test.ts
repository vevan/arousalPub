import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from './chat-storage.js'
import {
  formatSummarizeTranscript,
  wrapSummarizeTurnLine,
} from './plugin-summarize-format.js'

describe('wrapSummarizeTurnLine', () => {
  it('wraps user line with macro name and CDATA', () => {
    const line = wrapSummarizeTurnLine('user', 'hello')
    assert.equal(
      line,
      '<user name="{{user}}"><![CDATA[hello]]></user>',
    )
  })

  it('wraps char line with macro name', () => {
    const line = wrapSummarizeTurnLine('char', 'reply')
    assert.equal(
      line,
      '<char name="{{char}}"><![CDATA[reply]]></char>',
    )
  })

  it('returns empty for blank text', () => {
    assert.equal(wrapSummarizeTurnLine('user', '   '), '')
  })
})

describe('formatSummarizeTranscript', () => {
  it('emits xml user/char per turn separated by newlines', () => {
    const turns: TurnRecord[] = [
      {
        turnId: 't0',
        turnOrdinal: 0,
        send: { userText: 'hi' },
        receives: [{ content: 'hello back' }],
        activeReceiveIndex: 0,
        plugins: [],
      },
    ]
    const out = formatSummarizeTranscript(turns, 'Alice', 'Bob')
    assert.equal(
      out,
      '<user name="{{user}}"><![CDATA[hi]]></user>\n<char name="{{char}}"><![CDATA[hello back]]></char>',
    )
  })
})
