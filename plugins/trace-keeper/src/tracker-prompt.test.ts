import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import {

  buildSeparateSystemPrompt,

  buildTrackerSystemPrompt,

} from './tracker-prompt.js'

import type { TraceBundle } from './constants.js'



const SAMPLE_BUNDLE: TraceBundle = {

  id: 'test',

  label: 'test',

  sampleState: { scene: { location: 'sample' } },

  template: '<div></div>',

  stylesheet: '',

}



describe('buildTrackerSystemPrompt', () => {

  it('includes template and sample only', () => {

    const text = buildTrackerSystemPrompt(SAMPLE_BUNDLE)

    assert.match(text, /sample structure/)

    assert.match(text, /sample/)

    assert.doesNotMatch(text, /live state/)

    assert.doesNotMatch(text, /turn \d/)

  })

})



describe('buildSeparateSystemPrompt', () => {

  it('uses separateSystemPromptTemplate and JSON template section', () => {

    const text = buildSeparateSystemPrompt({

      ...SAMPLE_BUNDLE,

      separateSystemPromptTemplate: 'Separate custom.',

    })

    assert.match(text, /^Separate custom\./)

    assert.match(text, /JSON template/)

    assert.doesNotMatch(text, /ex-trace-keeper/)

  })

})


