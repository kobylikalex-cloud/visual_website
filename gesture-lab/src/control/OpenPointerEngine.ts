import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import { PointerController } from './PointerController.ts'
import { TargetSelector, distanceToTarget } from './TargetSelector.ts'
import type { InteractionFrame, InteractionSnapshot, TrackedHand } from './types.ts'

export type PointerDiagnostics = {
  raw: 'OPEN' | 'OTHER' | 'UNKNOWN'
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
    const gainOnly = config.pointerMode === this.config.pointerMode && config.pointerFilter === this.config.pointerFilter && config.pointerPreview === this.config.pointerPreview && (Object.keys(this.config) as (keyof GestureConfig)[]).every(key => key === 'pointerGain' || config[key] === this.config[key])
    if (gainOnly) {
      this.pointer.setGain(config.pointerGain)
      this.config = { ...config }
      return this.snapshot
    }
    this.config = { ...config }; this.pointer.configure(config); this.selector = new TargetSelector(config)
    return this.cancel('Movement calibration changed')
  }

  recenterPointer(): InteractionSnapshot {
    const result = this.cancel('Pointer recentered; confirm open palm')
    this.pointer.recenter()
    return result
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
    // Pose and camera-relative palm orientation are independent. With scrolling
    // disabled, a valid open hand aims equally in side-on and flat views.
    const raw = hand.pose === 'OPEN' ? 'OPEN' : hand.pose === 'UNKNOWN' ? 'UNKNOWN' : 'OTHER'
    this.diagnostics = { ...this.diagnostics, raw, handId: hand.id, quality: frame.reason, confirmed: false, observationAgeMs: receivedAt - time }
    if (raw !== 'OPEN') {
      this.candidateSince = null
      if (this.config.pointerMode === 'relative') this.pointer.reset()
      // A previously focused target can remain visually steady for the existing
      // confirmation interval. UNKNOWN never moves the pointer or renews this deadline.
      if (raw === 'UNKNOWN' && this.snapshot.focusId && time - this.lastOpen <= this.config.confirmationMs && frame.targets.some(t => t.id === this.snapshot.focusId && !t.disabled)) {
        return this.snapshot = { ...this.snapshot, mode: 'UNCERTAIN', pointer: null, reason: 'Brief uncertain pose; movement frozen' }
      }
      this.pointer.reset(); this.selector.reset()
      return this.snapshot = { ...empty(raw === 'OTHER' ? 'Open hand to aim' : 'Open palm uncertain'), mode: 'UNCERTAIN' }
    }
    const retainFocus = this.snapshot.focusId !== null && time - this.lastOpen <= this.config.confirmationMs &&
      frame.targets.some(target => target.id === this.snapshot.focusId && !target.disabled)
    this.lastOpen = time
    if (this.candidateSince === null) this.candidateSince = time
    if (time - this.candidateSince < this.config.confirmationMs) {
      if (this.config.pointerPreview) return this.preview(receivedAt)
      return this.snapshot = retainFocus
        ? { ...this.snapshot, mode: 'UNCERTAIN', pointer: null, reason: 'Reconfirming open palm; movement frozen' }
        : { ...empty('Confirming open palm'), mode: 'UNCERTAIN' }
    }
    this.diagnostics.confirmed = true
    return this.render(receivedAt)
  }

  tick(now: number): InteractionSnapshot {
    if (!this.hand || !this.frame) return this.snapshot
    this.diagnostics.observationAgeMs = now - this.hand.timestampMs
    // The pose dwell is not a transport deadline. Initial/release confirmation
    // may span several fresh observations delivered after inference. Only a
    // genuinely uncertain pose uses the shorter visual-focus hold.
    if (now - this.hand.timestampMs > this.config.freshnessMs ||
        (this.diagnostics.raw === 'UNKNOWN' && this.snapshot.focusId !== null &&
          now - this.lastOpen > this.config.confirmationMs)) return this.cancel('Observation expired; movement stopped')
    return this.diagnostics.confirmed ? this.render(now)
      : this.config.pointerPreview && this.diagnostics.raw === 'OPEN' ? this.preview(now) : this.snapshot
  }

  /** Known OPEN geometry can follow movement before it authorizes any action.
   * UNKNOWN never enters this path; action confirmation stays independent. */
  private preview(now: number): InteractionSnapshot {
    return this.snapshot = { ...this.render(now), mode: 'UNCERTAIN', reason: 'Confirming open palm; movement preview only' }
  }

  private render(now: number): InteractionSnapshot {
    const frame = this.frame!, hand = this.hand!
    const pointer = this.pointer.update(hand.center, now, frame.viewport, hand.timestampMs)
    const selection = this.selector.update(pointer, frame.targets, now)
    const target = frame.targets.find(t => t.id === selection.focusId)
    this.diagnostics.distance = target ? distanceToTarget(pointer, target) : null
    return this.snapshot = { ...empty('OPEN · highlight only'), mode: 'POINTER', pointer, ...selection }
  }
}
