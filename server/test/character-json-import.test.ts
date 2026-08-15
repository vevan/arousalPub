import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cardFromCharaJson,
  normalizeTavernCardV2Data,
} from '../src/character-png.js'
import { normalizeImportCard } from '../src/character-storage.js'

describe('character JSON import (ST envelope)', () => {
  it('unwraps { card: { spec, data } } for v2 and v3 envelopes', () => {
    const samples = [
      {
        name: '佐倉 美稚',
        raw: {
          spec: 'chara_card_v3',
          spec_version: '3.0',
          data: {
            name: '佐倉 美稚',
            description: 'v3 desc',
            personality: 'v3 personality',
            first_mes: 'v3 first',
          },
        },
      },
      {
        name: '瑞秋',
        raw: {
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: {
            name: '瑞秋',
            description: 'v2 desc',
            personality: 'v2 personality',
            first_mes: 'v2 first',
          },
        },
      },
    ]

    for (const sample of samples) {
      const viaWrapped = normalizeImportCard({ card: sample.raw })
      const viaBare = normalizeImportCard(sample.raw)
      const viaChara = cardFromCharaJson(sample.raw)

      assert.equal(viaWrapped.name, sample.name, `${sample.name} wrapped`)
      assert.equal(viaBare.name, sample.name, `${sample.name} bare`)
      assert.equal(viaChara.name, sample.name, `${sample.name} chara`)

      const normalized = normalizeTavernCardV2Data(viaWrapped)
      assert.ok(
        String(normalized.description ?? '').trim().length > 0,
        `${sample.name} description`,
      )
      assert.ok(
        String(normalized.first_mes ?? '').trim().length > 0,
        `${sample.name} first_mes`,
      )
      assert.ok(
        String(normalized.personality ?? '').trim().length > 0,
        `${sample.name} personality`,
      )
    }
  })

  it('keeps flat { card: { name } } unchanged', () => {
    const flat = normalizeImportCard({
      card: {
        name: 'Flat Char',
        description: 'd',
        personality: 'p',
      },
    })
    assert.equal(flat.name, 'Flat Char')
    assert.equal(flat.description, 'd')
  })

  it('does not unwrap custom data when top-level name exists without spec', () => {
    const card = normalizeImportCard({
      card: {
        name: 'Keep Me',
        description: 'top',
        data: { name: 'Inner', description: 'inner' },
      },
    })
    assert.equal(card.name, 'Keep Me')
    assert.equal(card.description, 'top')
  })
})
