import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import { PointerController } from './PointerController.ts'
import { TargetSelector, distanceToTarget } from './TargetSelector.ts'
import type { InteractionFrame, InteractionSnapshot, TrackedHand } from './types.ts'

export type PointerDiagnostics = {
  raw: 'OPEN_UPRIGHT' | 'OTHER' | 'UNKNOWN'
  confirmed: boolean
  handId: number | null
  quality: string
  distance: number | null
  observationAgeMs: number | null
}
const empty = (reason: string): InteractionSnapshot => ({ mode: 'IDLE', focusId: null, proximity: {}, pointer: null, clickId: null, drag: null, scrollVelocity: 0, reason })

/** Sprint 01 has no action adapter: only pointer geometry and target feedback. */
export class OpenPointerEngine {
  private config: GestureConfig
  private pointer: PointerController
  private selector: TargetSelector
  private frame: InteractionFrame | null = null
  private hand: TrackedHand | null = null
  private candidateSince: number | null = null
  private lastOpen = -Infinity
  private lastTimestamp = -Infinity
  private snapshot = empty('Start camera to begin.')
  diagnostics: PointerDiagnostics = { raw: 'UNKNOWN', confirmed: false, handId: null, quality: 'No observation', distance: null, observationAgeMs: null }

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) {
    this.config = { ...config }; this.pointer = new PointerController(config); this.selector = new TargetSelector(config)
  }

  configure(config: GestureConfig) {
    this.config = { ...config }; this.pointer = new PointerController(config); this.selector = new TargetSelector(config)
    return this.cancel('Movement calibration changed')
  }

  cancel(reason = 'Paused'): InteractionSnapshot {
    this.hand = null; this.frame = null; this.candidateSince = null; this.lastOpen = -Infinity
    this.lastTimestamp = -Infinity; this.pointer.reset(); this.selector.reset()
    this.diagnostics = { raw: 'UNKNOWN', confirmed: false, handId: null, quality: reason, distance: null, observationAgeMs: null }
    return this.snapshot = empty(reason)
  }

  update(frame: InteractionFrame, receivedAt: number): InteractionSnapshot {
    const time = frame.timestampMs
    if (!Number.isFinite(time) || !Number.isFinite(receivedAt) || time <= this.lastTimestamp || receivedAt < time || receivedAt - time > this.config.freshnessMs) return this.cancel('Stale or invalid observation')
    if (frame.ambiguous || frame.hands.length !== 1) return this.cancel(frame.ambiguous ? frame.reason : frame.hands.length ? 'Use one hand only' : 'No hand detected')
    const hand = frame.hands[0]
    if (hand.timestampMs !== time || !Number.isFinite(hand.center.x) || !Number.isFinite(hand.center.y) || frame.viewport.width <= 0 || frame.viewport.height <= 0) return this.cancel('Invalid palm observation')
    if (this.frame && (frame.viewport.width !== this.frame.viewport.width || frame.viewport.height !== this.frame.viewport.height)) return this.cancel('Viewport changed')
    if (this.hand && (hand.id !== this.hand.id || time - this.hand.timestampMs > this.config.freshnessMs)) this.cancel('Hand reacquired; confirm open palm')
    this.lastTimestamp = time; this.frame = frame; this.hand = hand
    const raw = hand.pose === 'OPEN' && hand.orientation === 'UPRIGHT_LIKE' ? 'OPEN_UPRIGHT'
      : hand.pose === 'UNKNOWN' || hand.orientation === 'TRANSITION' ? 'UNKNOWN' : 'OTHER'
    this.diagnostics = { ...this.diagnostics, raw, handId: hand.id, quality: frame.reason, confirmed: false, observationAgeMs: receivedAt - time }
    if (raw !== 'OPEN_UPRIGHT') {
      this.candidateSince = null
      // A previously focused target can remain visually steady for the existing
      // confirmation interval. UNKNOWN never moves the pointer or renews this deadline.
      if (raw === 'UNKNOWN' && this.snapshot.focusId && time - this.lastOpen <= this.config.confirmationMs && frame.targets.some(t => t.id === this.snapshot.focusId && !t.disabled)) {
        return this.snapshot = { ...this.snapshot, mode: 'UNCERTAIN', pointer: null, reason: 'Brief uncertain pose; movement frozen' }
      }
      this.pointer.reset(); this.selector.reset()
      return this.snapshot = { ...empty(raw === 'OTHER' ? 'Only upright open palm is enabled' : 'Open palm uncertain'), mode: 'UNCERTAIN' }
    }
    const retainFocus = this.snapshot.focusId !== null && time - this.lastOpen <= this.config.confirmationMs &&
      frame.targets.some(target => target.id === this.snapshot.focusId && !target.disabled)
    this.lastOpen = time
    if (this.candidateSince === null) this.candidateSince = time
    if (time - this.candidateSince < this.config.confirmationMs) return this.snapshot = retainFocus
      ? { ...this.snapshot, mode: 'UNCERTAIN', pointer: null, reason: 'Reconfirming upright open palm; movement frozen' }
      : { ...empty('Confirming upright open palm'), mode: 'UNCERTAIN' }
    this.diagnostics.confirmed = true
    return this.render(receivedAt)
  }

  tick(now: number): InteractionSnapshot {
    if (!this.hand || !this.frame) return this.snapshot
    this.diagnostics.observationAgeMs = now - this.hand.timestampMs
    if (now - this.hand.timestampMs > this.config.freshnessMs || (!this.diagnostics.confirmed && now - this.lastOpen > this.config.confirmationMs)) return this.cancel('Observation expired; movement stopped')
    return this.diagnostics.confirmed ? this.render(now) : this.snapshot
  }

  private render(now: number): InteractionSnapshot {
    const frame = this.frame!, hand = this.hand!
    const pointer = this.pointer.update(hand.center, now, frame.viewport)
    const selection = this.selector.update(pointer, frame.targets, now)
    const target = frame.targets.find(t => t.id === selection.focusId)
    this.diagnostics.distance = target ? distanceToTarget(pointer, target) : null
    return this.snapshot = { ...empty('OPEN_UPRIGHT · highlight only'), mode: 'POINTER', pointer, ...selection }
  }
}
