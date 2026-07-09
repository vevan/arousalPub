import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useUiContextStore } from '../../src/stores/ui-context.js'
import { executeNotificationAction, setNotificationRoutePusher } from '../../src/utils/notification-action.js'

describe('executeNotificationAction', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('library-panel lorebooks opens dialog with focus id', () => {
    const ui = useUiContextStore()
    const before = ui.openLorebooksSignal
    executeNotificationAction({
      type: 'library-panel',
      panel: 'lorebooks',
      focusId: 'lb-1',
    })
    assert.equal(ui.openLorebooksSignal, before + 1)
    assert.equal(ui.consumePendingLorebookFocusId(), 'lb-1')
  })

  it('settings-tab opens settings signal', () => {
    const ui = useUiContextStore()
    const before = ui.openSettingsSignal
    executeNotificationAction({
      type: 'settings-tab',
      settingsTab: 'import',
    })
    assert.equal(ui.openSettingsSignal, before + 1)
    assert.equal(ui.consumePendingSettingsTab(), 'import')
  })

  it('conversation action uses injected route pusher', async () => {
    let pushed: unknown = null
    setNotificationRoutePusher(async (location) => {
      pushed = location
    })
    await executeNotificationAction({
      type: 'conversation',
      conversationId: 'conv-1',
    })
    assert.deepEqual(pushed, {
      name: 'chat',
      params: { conversationId: 'conv-1' },
    })
  })
})
