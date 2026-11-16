import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyEntitlementEvent,
  createEntitlementLedger,
  createInMemoryEntitlementStore,
  getAvailableUnits,
} from '../src/membership/entitlementLedger.js'

const apply = (state, id, type, extra = {}) => applyEntitlementEvent(state, { id, type, ...extra })

test('a successful simulated job consumes only reserved units', () => {
  const granted = apply(createEntitlementLedger(), 'e1', 'grant', { grantId: 'g1', units: 5 })
  const reserved = apply(granted, 'e2', 'reserve', { jobId: 'j1', units: 2 })
  assert.equal(getAvailableUnits(reserved), 3)
  assert.deepEqual([reserved.reserved, reserved.spent], [2, 0])
  const committed = apply(reserved, 'e3', 'commit', { jobId: 'j1' })
  assert.deepEqual([committed.reserved, committed.spent, getAvailableUnits(committed)], [0, 2, 3])
  assert.equal(granted.spent, 0)
})

test('failure releases a reservation without charging units', () => {
  let state = apply(createEntitlementLedger(), 'e1', 'grant', { grantId: 'g1', units: 2 })
  state = apply(state, 'e2', 'reserve', { jobId: 'j1', units: 2 })
  state = apply(state, 'e3', 'release', { jobId: 'j1' })
  assert.deepEqual([state.reserved, state.spent, getAvailableUnits(state)], [0, 0, 2])
  assert.throws(() => apply(state, 'e4', 'commit', { jobId: 'j1' }), /not reserved/)
})

test('duplicate events are idempotent and conflicting ids fail closed', () => {
  const event = { id: 'e1', type: 'grant', grantId: 'g1', units: 3 }
  const state = applyEntitlementEvent(createEntitlementLedger(), event)
  assert.strictEqual(applyEntitlementEvent(state, event), state)
  assert.throws(() => apply(state, 'e1', 'grant', { grantId: 'g1', units: 4 }), /Conflicting/)
  assert.throws(() => apply(state, 'e2', 'grant', { grantId: 'g1', units: 3 }), /already exists/)
})

test('sequential reservations cannot overdraw and a job cannot settle twice', () => {
  let state = apply(createEntitlementLedger(), 'e1', 'grant', { grantId: 'g1', units: 3 })
  state = apply(state, 'e2', 'reserve', { jobId: 'j1', units: 2 })
  assert.throws(() => apply(state, 'e3', 'reserve', { jobId: 'j2', units: 2 }), /Insufficient/)
  state = apply(state, 'e4', 'commit', { jobId: 'j1' })
  assert.throws(() => apply(state, 'e5', 'commit', { jobId: 'j1' }), /not reserved/)
  assert.equal(getAvailableUnits(state), 1)
})

test('concurrent reservations in one process cannot overdraw', async () => {
  const store = createInMemoryEntitlementStore()
  await store.apply({ id: 'e1', type: 'grant', grantId: 'g1', units: 3 })
  const results = await Promise.allSettled([
    store.apply({ id: 'e2', type: 'reserve', jobId: 'j1', units: 2 }),
    store.apply({ id: 'e3', type: 'reserve', jobId: 'j2', units: 2 }),
  ])
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected'])
  assert.equal(getAvailableUnits(store.snapshot()), 1)
  await store.apply({ id: 'e4', type: 'reserve', jobId: 'j3', units: 1 })
  assert.equal(getAvailableUnits(store.snapshot()), 0)
  const externalSnapshot = store.snapshot()
  externalSnapshot.granted = 1000
  assert.equal(getAvailableUnits(store.snapshot()), 0)
})

test('only a completely unused account can revoke a grant automatically', () => {
  let state = apply(createEntitlementLedger(), 'e1', 'grant', { grantId: 'g1', units: 2 })
  state = apply(state, 'e2', 'revoke', { grantId: 'g1' })
  assert.equal(getAvailableUnits(state), 0)
  assert.throws(() => apply(state, 'e3', 'revoke', { grantId: 'g1' }), /not active/)

  let reserved = apply(createEntitlementLedger(), 'e1', 'grant', { grantId: 'g1', units: 2 })
  reserved = apply(reserved, 'e2', 'reserve', { jobId: 'j1', units: 1 })
  assert.throws(() => apply(reserved, 'e3', 'revoke', { grantId: 'g1' }), /manual reconciliation/)
  const committed = apply(reserved, 'e4', 'commit', { jobId: 'j1' })
  assert.throws(() => apply(committed, 'e5', 'revoke', { grantId: 'g1' }), /manual reconciliation/)
})

test('invalid units and identifiers never enter the ledger', () => {
  const state = createEntitlementLedger()
  for (const units of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => apply(state, 'e1', 'grant', { grantId: 'g1', units }), /Invalid units/)
  }
  assert.throws(() => apply(state, '../bad', 'grant', { grantId: 'g1', units: 1 }), /Invalid event id/)
  const specialId = apply(state, '__proto__', 'grant', { grantId: 'constructor', units: 1 })
  assert.equal(getAvailableUnits(specialId), 1)
  const reloaded = JSON.parse(JSON.stringify(specialId))
  assert.strictEqual(apply(reloaded, '__proto__', 'grant', { grantId: 'constructor', units: 1 }), reloaded)
  assert.equal(getAvailableUnits(state), 0)
})
