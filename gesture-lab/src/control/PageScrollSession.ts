import type { TrackedHand } from './types.ts'

export const DEFAULT_PAGE_SCROLL_CONFIG = { confirmationMs: 200, settleMs: 250, minObservations: 3, deadZone: .03,
  range: .16, maxSpeed: 600, freshnessMs: 200, maxFrameMs: 50 }
export type PageScrollConfig = typeof DEFAULT_PAGE_SCROLL_CONFIG
export type ScrollSessionSnapshot = { state: 'INACTIVE' | 'ENTRY' | 'ACTIVE' | 'PAUSED'; neutralY: number | null; displacement: number; velocity: number; deltaY: number; reason: string }
const empty = (reason: string): ScrollSessionSnapshot => ({ state: 'INACTIVE', neutralY: null, displacement: 0, velocity: 0, deltaY: 0, reason })

/** One identity, one immutable entry neutral, no momentum or queued effects. */
export class PageScrollSession {
  private config: PageScrollConfig
  private handId: number | null = null
  private lastObservation = -Infinity
  private candidateSince = 0
  private observations = 0
  private settled: { time: number; y: number }[] = []
  private motion: { origin: number; extreme: number; direction: number; observations: number; directedObservations: number } | null = null
  private lastTick: number | null = null
  private pausedState: 'ENTRY' | 'ACTIVE' | null = null
  private snapshot = empty('Raise a flat open hand')

  constructor(config: PageScrollConfig = DEFAULT_PAGE_SCROLL_CONFIG) {
    if (!Object.values(config).every(Number.isFinite) || config.deadZone <= 0 || config.range <= config.deadZone || config.range > 1 ||
      config.maxSpeed <= 0 || config.confirmationMs < 0 || config.settleMs < 0 || config.minObservations < 3 || config.freshnessMs <= 0 || config.maxFrameMs <= 0) throw new RangeError('Invalid page scroll configuration')
    this.config = { ...config }
  }

  reset(reason = 'Scrolling stopped') {
    this.handId = null; this.lastObservation = -Infinity; this.observations = 0; this.settled = []; this.motion = null; this.lastTick = null; this.pausedState = null
    return this.snapshot = empty(reason)
  }

  /** Uncertain frames preserve recent evidence but never renew OPEN freshness or add confirmations. */
  pause(hand: TrackedHand, receivedAt: number, reason = 'Open palm uncertain; scrolling paused'): ScrollSessionSnapshot {
    if (this.snapshot.state === 'INACTIVE' || (hand.pose !== 'UNKNOWN' && hand.pose !== 'OPEN') || hand.id !== this.handId ||
      !Number.isFinite(hand.timestampMs + receivedAt) || hand.timestampMs <= this.lastObservation ||
      receivedAt < hand.timestampMs || receivedAt - this.lastObservation > this.config.freshnessMs) {
      return this.reset('Open palm confirmation lost; begin a new flat-hand stroke')
    }
    if (this.snapshot.state !== 'PAUSED') this.pausedState = this.snapshot.state
    // No directed-entry evidence may span an uncertain/returning posture.
    // An already confirmed neutral remains governed by the OPEN deadline.
    this.motion = null
    this.lastTick = null
    return this.snapshot = { ...this.snapshot, state: 'PAUSED', velocity: 0, deltaY: 0,
      reason }
  }

  observe(hand: TrackedHand, mayEnter: boolean, mayRetain: boolean, receivedAt: number): ScrollSessionSnapshot {
    const t = hand.timestampMs
    if (!Number.isFinite(t + receivedAt + hand.center.y) || t < 0 || receivedAt < t || receivedAt - t > this.config.freshnessMs ||
      t <= this.lastObservation || this.handId !== null && (hand.id !== this.handId || t - this.lastObservation > this.config.freshnessMs) ||
      hand.center.y < 0 || hand.center.y > 1 || hand.pose !== 'OPEN' || !mayRetain) return this.reset('Fresh single open flat hand required')
    this.lastObservation = t
    if (this.snapshot.state === 'PAUSED') {
      this.snapshot = { ...this.snapshot, state: this.pausedState ?? 'ENTRY' }
      this.pausedState = null
      this.lastTick = receivedAt // never integrate time spent paused
    }
    if (this.snapshot.state !== 'ACTIVE' && !mayEnter) return this.reset('Complete the flat-hand rotation')
    if (this.handId === null) {
      this.handId = hand.id; this.candidateSince = t
      this.snapshot = { ...empty('Confirming flat posture'), state: 'ENTRY' }
    }
    this.observations++
    if (this.snapshot.state !== 'ACTIVE') {
      const movingNeutral = this.observeEntryMotion(hand.center.y)
      // The same fresh OPEN samples can establish posture and stable height.
      // Waiting for confirmation before collecting height unnecessarily adds
      // both windows and can move neutral to the end of the user's first stroke.
      this.settled.push({ time: t, y: hand.center.y })
      const heights = this.settled.map(s => s.y)
      if (Math.max(...heights) - Math.min(...heights) > this.config.deadZone) this.settled = [{ time: t, y: hand.center.y }]
      let neutralY = movingNeutral
      if (neutralY === null) {
        if (this.observations < this.config.minObservations || t - this.candidateSince < this.config.confirmationMs) return this.snapshot
        if (t - this.settled[0].time < this.config.settleMs) return this.snapshot = { ...this.snapshot, reason: 'Move the flat hand up or down to scroll' }
        neutralY = this.settled.reduce((sum, s) => sum + s.y, 0) / this.settled.length
      }
      this.snapshot = { ...this.snapshot, state: 'ACTIVE', neutralY, reason: 'Neutral · page stationary' }
      this.settled = []; this.motion = null; this.lastTick = receivedAt
    }
    const displacement = hand.center.y - this.snapshot.neutralY!
    const u = Math.max(0, Math.min(1, (Math.abs(displacement) - this.config.deadZone) / (this.config.range - this.config.deadZone)))
    const velocity = Math.sign(displacement) * this.config.maxSpeed * (3 * u * u - 2 * u * u * u)
    return this.snapshot = { ...this.snapshot, displacement, velocity: velocity || 0, deltaY: 0,
      reason: velocity === 0 ? 'Neutral · page stationary' : velocity < 0 ? 'Scrolling up' : 'Scrolling down' }
  }

  /** Intent evidence, not a relaxed finger/orientation classifier. A directed
   * stroke beyond the existing neutral band can enter without a timed dwell,
   * after at least the existing minimum of fresh strong-flat OPEN samples.
   * Reversal beyond that same noise band starts a new stroke; one outlier or
   * alternating motion cannot prepare an action. Neutral stays at its origin. */
  private observeEntryMotion(y: number): number | null {
    if (this.motion === null) {
      this.motion = { origin: y, extreme: y, direction: 0, observations: 1, directedObservations: 0 }
      return null
    }
    const motion = this.motion
    if (motion.direction !== 0 && (y - motion.extreme) * motion.direction < -this.config.deadZone) {
      this.motion = { origin: y, extreme: y, direction: 0, observations: 1, directedObservations: 0 }
      return null
    }
    motion.observations++
    const displacement = y - motion.origin
    if (motion.direction === 0 && Math.abs(displacement) > this.config.deadZone) motion.direction = Math.sign(displacement)
    if (motion.direction !== 0 && (y - motion.extreme) * motion.direction > 0) motion.extreme = y
    motion.directedObservations = Math.abs(displacement) > this.config.deadZone && Math.sign(displacement) === motion.direction
      ? motion.directedObservations + 1 : 0
    return motion.observations >= this.config.minObservations && motion.directedObservations >= this.config.minObservations - 1
      ? motion.origin : null
  }

  tick(now: number): ScrollSessionSnapshot {
    if (!Number.isFinite(now) || now < this.lastObservation || now - this.lastObservation > this.config.freshnessMs) return this.reset('Scroll observation expired')
    const dt = this.lastTick === null ? 0 : Math.max(0, Math.min(this.config.maxFrameMs, now - this.lastTick))
    this.lastTick = now
    return this.snapshot = { ...this.snapshot, deltaY: this.snapshot.state === 'ACTIVE' ? this.snapshot.velocity * dt / 1000 : 0 }
  }
}
