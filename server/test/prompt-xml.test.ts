import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  cardRecordToCharXmlBlock,
  cardRecordToUserXmlBlock,
  formatPersonaFieldXml,
} from '../src/prompt-xml.js'

describe('formatPersonaFieldXml', () => {
  it('wraps field with name and attribute', () => {
    assert.equal(
      formatPersonaFieldXml('char', 'Alice', 'description', 'A brave knight'),
      '<char name="Alice" attribute="description">A brave knight</char>',
    )
  })

  it('escapes attribute and body special chars', () => {
    assert.equal(
      formatPersonaFieldXml('user', 'Bob "B"', 'personality', 'Says <hi>'),
      '<user name="Bob &quot;B&quot;" attribute="personality">Says &lt;hi&gt;</user>',
    )
  })
})

describe('cardRecordToCharXmlBlock', () => {
  it('emits one char element per populated field', () => {
    const xml = cardRecordToCharXmlBlock({
      name: 'moka',
      description: 'Sample description',
      personality: 'Sample personality',
      scenario: 'Sample scenario',
      mes_example: '<START>\n{{user}}: hi',
    })
    assert.match(xml, /^<char name="moka" attribute="description">/)
    assert.match(xml, /<char name="moka" attribute="personality">/)
    assert.match(xml, /<char name="moka" attribute="scenario">/)
    assert.match(xml, /<char name="moka" attribute="mes_example">/)
    assert.doesNotMatch(xml, /<char>\s*\n/)
    assert.doesNotMatch(xml, /<description>/)
  })

  it('falls back to placeholder description when card is empty', () => {
    const xml = cardRecordToCharXmlBlock({ name: 'empty' })
    assert.equal(
      xml,
      '<char name="empty" attribute="description">(No description)</char>',
    )
  })
})

describe('cardRecordToUserXmlBlock', () => {
  it('uses user root tag', () => {
    const xml = cardRecordToUserXmlBlock({
      name: 'Player',
      description: 'Persona body',
    })
    assert.equal(
      xml,
      '<user name="Player" attribute="description">Persona body</user>',
    )
  })
})
