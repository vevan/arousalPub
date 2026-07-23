import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatSummarizeTaskNotifyLabel,
  formatSummarizeTaskTitlePart,
} from '../src/shared/task-notify-label.js'
import type { PluginHost, SummarizeTask } from '../src/types.js'

function mockHost(messages: Record<string, string>): PluginHost {
  const pluginKey = (key: string) => `plugins.plot-summary.${key}`
  return {
    pluginKey,
    t: (key: string) => messages[key] ?? key,
  } as PluginHost
}

describe('formatSummarizeTaskTitlePart', () => {
  const host = mockHost({
    'plugins.plot-summary.manualTaskMemory': '剧情纪要',
  })

  it('formats memory task with memo index and turn range', () => {
    const task: SummarizeTask = { kind: 'memory' }
    assert.equal(
      formatSummarizeTaskTitlePart(host, task, 31, 45, 7),
      '[MEMO-01] 剧情纪要 [31-45]',
    )
  })

  it('formats memory task with explicit session memoIndex', () => {
    const task: SummarizeTask = { kind: 'memory' }
    assert.equal(
      formatSummarizeTaskTitlePart(host, task, 31, 45, 7, 12),
      '[MEMO-12] 剧情纪要 [31-45]',
    )
  })

  it('formats sidecar task with sidecar name', () => {
    const task: SummarizeTask = {
      kind: 'sidecar',
      sidecar: {
        id: 'sc-1',
        name: '人物关系',
        systemPromptTemplate: '',
        priority: 90,
        triggerMode: 'constant',
        enabled: true,
      },
    }
    assert.equal(formatSummarizeTaskTitlePart(host, task, 0, 15, 15), '人物关系')
  })
})

describe('formatSummarizeTaskNotifyLabel', () => {
  const host = mockHost({
    'plugins.plot-summary.manualTaskMemory': '剧情纪要',
  })

  it('prefixes lorebook name', () => {
    const task: SummarizeTask = { kind: 'memory' }
    assert.equal(
      formatSummarizeTaskNotifyLabel(host, 'LTM - alice', task, 31, 45, 7),
      'LTM - alice - [MEMO-01] 剧情纪要 [31-45]',
    )
  })

  it('prefixes lorebook name for sidecar', () => {
    const task: SummarizeTask = {
      kind: 'sidecar',
      sidecar: {
        id: 'sc-2',
        name: '任务列表',
        systemPromptTemplate: '',
        priority: 90,
        triggerMode: 'constant',
        enabled: true,
      },
    }
    assert.equal(
      formatSummarizeTaskNotifyLabel(host, 'LTM - alice', task, 0, 15, 15),
      'LTM - alice - 任务列表',
    )
  })
})
