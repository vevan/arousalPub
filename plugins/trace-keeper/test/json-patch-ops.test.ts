import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyTracePatchOps } from '../src/json-patch-ops.js'

describe('applyTracePatchOps', () => {
  const base = {
    scene: { location: '未知地点', time: '未知时间', weather: '未知' },
    mood: '平静',
    notes: '',
  }

  it('replace / add / remove in one batch', () => {
    const r = applyTracePatchOps(base, [
      { op: 'replace', path: '/mood', value: '紧张' },
      { op: 'replace', path: '/scene/location', value: '旧码头仓库' },
      { op: 'add', path: '/flags', value: { alarmRaised: true } },
      { op: 'add', path: '/inventory', value: ['锈钥匙'] },
      { op: 'add', path: '/inventory/-', value: '油灯' },
      { op: 'remove', path: '/notes' },
    ])
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.applied, 6)
    assert.equal(r.state.mood, '紧张')
    assert.deepEqual(r.state.scene, {
      location: '旧码头仓库',
      time: '未知时间',
      weather: '未知',
    })
    assert.deepEqual(r.state.flags, { alarmRaised: true })
    assert.deepEqual(r.state.inventory, ['锈钥匙', '油灯'])
    assert.equal('notes' in r.state, false)
    // 原对象不变
    assert.equal(base.mood, '平静')
  })

  it('replace fails when path missing', () => {
    const r = applyTracePatchOps(base, [
      { op: 'replace', path: '/missing', value: 1 },
    ])
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'path_not_found')
    assert.equal(r.opIndex, 0)
  })

  it('add fails when path exists', () => {
    const r = applyTracePatchOps(base, [
      { op: 'add', path: '/mood', value: 'x' },
    ])
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.code, 'path_exists')
  })

  it('rolls back whole batch on mid failure', () => {
    const r = applyTracePatchOps(base, [
      { op: 'replace', path: '/mood', value: '紧张' },
      { op: 'replace', path: '/nope', value: 1 },
    ])
    assert.equal(r.ok, false)
    if (r.ok) return
    assert.equal(r.opIndex, 1)
  })
})
