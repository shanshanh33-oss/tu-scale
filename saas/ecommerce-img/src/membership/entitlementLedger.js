// Offline prototype only. A real service must apply each transition inside a
// durable database transaction after authenticating the account and event.

const emptyIndex = () => Object.create(null)
const copyIndex = index => Object.assign(emptyIndex(), index)

export function createEntitlementLedger() {
  return { granted: 0, reserved: 0, spent: 0, grants: emptyIndex(), jobs: emptyIndex(), events: emptyIndex() }
}

export function getAvailableUnits(ledger) {
  return ledger.granted - ledger.reserved - ledger.spent
}

const requireId = (value, label) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

const requireUnits = value => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid units')
  return value
}

const eventSignature = event => JSON.stringify({
  type: event.type,
  grantId: event.grantId ?? null,
  jobId: event.jobId ?? null,
  units: event.units ?? null,
})

export function applyEntitlementEvent(ledger, event) {
  if (!ledger || typeof ledger !== 'object' || !event || typeof event !== 'object') {
    throw new Error('Invalid ledger event')
  }
  const eventId = requireId(event.id, 'event id')
  const signature = eventSignature(event)
  if (Object.hasOwn(ledger.events, eventId)) {
    if (ledger.events[eventId] !== signature) throw new Error('Conflicting event id')
    return ledger
  }

  const next = {
    ...ledger,
    grants: copyIndex(ledger.grants),
    jobs: copyIndex(ledger.jobs),
    events: copyIndex(ledger.events),
  }

  switch (event.type) {
    case 'grant': {
      const grantId = requireId(event.grantId, 'grant id')
      const units = requireUnits(event.units)
      if (Object.hasOwn(next.grants, grantId)) throw new Error('Grant already exists')
      if (!Number.isSafeInteger(next.granted + units)) throw new Error('Unit overflow')
      next.grants[grantId] = { units, status: 'active' }
      next.granted += units
      break
    }
    case 'reserve': {
      const jobId = requireId(event.jobId, 'job id')
      const units = requireUnits(event.units)
      if (Object.hasOwn(next.jobs, jobId)) throw new Error('Job already exists')
      if (getAvailableUnits(next) < units) throw new Error('Insufficient units')
      next.jobs[jobId] = { units, status: 'reserved' }
      next.reserved += units
      break
    }
    case 'commit':
    case 'release': {
      const jobId = requireId(event.jobId, 'job id')
      const job = next.jobs[jobId]
      if (!job || job.status !== 'reserved') throw new Error('Job is not reserved')
      next.jobs[jobId] = { ...job, status: event.type === 'commit' ? 'committed' : 'released' }
      next.reserved -= job.units
      if (event.type === 'commit') next.spent += job.units
      break
    }
    case 'revoke': {
      const grantId = requireId(event.grantId, 'grant id')
      const grant = next.grants[grantId]
      if (!grant || grant.status !== 'active') throw new Error('Grant is not active')
      // Without per-grant spend attribution, any active or completed job needs
      // a human review before a specific grant can be withdrawn.
      if (next.reserved > 0 || next.spent > 0 || getAvailableUnits(next) < grant.units) {
        throw new Error('Grant requires manual reconciliation')
      }
      next.grants[grantId] = { ...grant, status: 'revoked' }
      next.granted -= grant.units
      break
    }
    default:
      throw new Error('Unknown event type')
  }

  next.events[eventId] = signature
  return next
}

// Demonstrates the transaction boundary for a single process. It is not a
// replacement for cross-process database transactions in a paid service.
export function createInMemoryEntitlementStore(initial = createEntitlementLedger()) {
  let current = structuredClone(initial)
  let tail = Promise.resolve()
  return {
    snapshot: () => structuredClone(current),
    apply(event) {
      const result = tail.then(() => {
        current = applyEntitlementEvent(current, event)
        return structuredClone(current)
      })
      tail = result.then(() => undefined, () => undefined)
      return result
    },
  }
}
