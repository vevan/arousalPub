import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractIfCondition } from '../../src/prompt-macros/cst/block-parse.js'
import {
  splitColonArgs,
  splitColonMacroBody,
} from '../../src/prompt-macros/macro-tag-parse.js'

describe('splitColonArgs', () => {
  it('splits plain :: args', () => {
    assert.deepEqual(splitColonArgs('a::b::c'), ['a', 'b', 'c'])
  })

  it('does not split :: inside nested macros', () => {
    assert.deepEqual(splitColonArgs('tpl::{{getvar::k::default}}::tail'), [
      'tpl',
      '{{getvar::k::default}}',
      'tail',
    ])
  })

  it('preserves nested macros when splitting setvar body', () => {
    const body =
      "setvar::gmNotebookTemplate::<details>{{getvar::gmNotebook::- [R] notes.}}</details>"
    const { name, args } = splitColonMacroBody(body)
    assert.equal(name, 'setvar')
    assert.equal(
      args,
      "gmNotebookTemplate::<details>{{getvar::gmNotebook::- [R] notes.}}</details>",
    )
    assert.deepEqual(splitColonArgs(args), [
      'gmNotebookTemplate',
      '<details>{{getvar::gmNotebook::- [R] notes.}}</details>',
    ])
  })

  it('extractIfCondition keeps spaces inside nested macros', () => {
    assert.equal(
      extractIfCondition('if::{{getvar:: flag :: 1 }}'),
      '{{getvar:: flag :: 1 }}',
    )
  })
})
