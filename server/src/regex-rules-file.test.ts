import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeRegexRulesDocument,
  RegexRulesValidationError,
} from './regex-rules-file.js'

describe('normalizeRegexRulesDocument', () => {
  it('accepts valid rules document', () => {
    const doc = normalizeRegexRulesDocument({
      rules: [
        {
          id: 'a1b2c3d4',
          label: 'strip',
          order: 10,
          enabled: true,
          phases: ['persist'],
          fields: ['assistant'],
          skipLastNTurns: 0,
          pattern: 'track',
          flags: 'g',
          replacement: '',
        },
      ],
    })
    assert.equal(doc.rules.length, 1)
    assert.equal(doc.rules[0]?.id, 'a1b2c3d4')
    assert.equal(doc.schemaVersion, 1)
  })

  it('allocates id for new rules', () => {
    const doc = normalizeRegexRulesDocument({
      rules: [
        {
          label: 'new',
          order: 10,
          enabled: true,
          phases: ['display'],
          fields: ['user'],
          skipLastNTurns: 0,
          pattern: 'x',
          flags: 'g',
          replacement: '',
        },
      ],
    })
    assert.match(doc.rules[0]?.id ?? '', /^[0-9a-f]{8}$/)
  })

  it('rejects invalid regexp on put', () => {
    assert.throws(
      () =>
        normalizeRegexRulesDocument({
          rules: [
            {
              id: 'a1b2c3d4',
              label: 'bad',
              order: 10,
              enabled: true,
              phases: ['display'],
              fields: ['user'],
              skipLastNTurns: 0,
              pattern: '[',
              flags: '',
              replacement: '',
            },
          ],
        }),
      RegexRulesValidationError,
    )
  })
})
