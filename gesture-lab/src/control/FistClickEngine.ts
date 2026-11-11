import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import { OpenPointerEngine, type PointerDiagnostics } from './OpenPointerEngine.ts'
import type { ActivationRequest } from './InteractionTargetRegistry.ts'
import type { InteractionFrame, InteractionSnapshot, InteractionTarget, Point2 } from './types.ts'

export const DEFAULT_CLICK_CONFIG = { focusStableMs: 150, fistConfirmationMs: 200, uncertaintyMs: 350, maxPalmTravel: .08 }
export type ClickState = 'OPEN' | 'TARGET_FOCUSED' | 'FIST_TRANSITION' | 'FIST_CONFIRMED' | 'CLICK' | 'WAIT_FOR_RELEASE'
export type ClickDiagnostics = {
  pose: 'OPEN' | 'FIST' | 'UNKNOWN'; state: ClickState; lockedTargetId: string | null; targetLocked: boolean
  progress: number; validClicks: number; rejectedAttempts: number; lastCancellation: string
  lastConfirmationMs: number | null; lastGestureLatencyMs: number | null
}
export type ClickSnapshot = InteractionSnapshot & { activation: ActivationRequest | null; targetLocked: boolean; clickState: ClickState; confirmationProgress: number }
type Lock = { target: InteractionTarget; handId: number; anchor: Point2; started: number; fistSince: number | null; frozen: InteractionSnapshot }

/** Adds deliberate activation around the unchanged, webcam-accepted pointer. */
export class FistClickEngine {
  private pointer: OpenPointerEngine
  private config: GestureConfig
  private readonly clickConfig: typeof DEFAULT_CLICK_CONFIG
  private frame: InteractionFrame | null = null
  private lock: Lock | null = null
  private anchor: Point2 | null = null
  private focusId: string | null = null
  private focusSince = 0
  private focusedTarget: InteractionTarget | null = null
  private sequence = 0
  private pendingAck: { sequence: number; since: number } | null = null
  private snapshot: ClickSnapshot
  diagnostics: PointerDiagnostics
  clickDiagnostics: ClickDiagnostics = { pose: 'UNKNOWN', state: 'OPEN', lockedTargetId: null, targetLocked: false, progress: 0,
    validClicks: 0, rejectedAttempts: 0, lastCancellation: '', lastConfirmationMs: null, lastGestureLatencyMs: null }

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG, clickConfig = DEFAULT_CLICK_CONFIG) {
    this.config = { ...config }; this.clickConfig = { ...clickConfig }; this.pointer = new OpenPointerEngine(config)
    this.diagnostics = { ...this.pointer.diagnostics }
    this.snapshot = this.wrap(this.pointer.cancel('Start camera to begin.'))
  }

  configure(config: GestureConfig): ClickSnapshot {
    if (this.pending()) this.cancel('Calibration changed during closure')
    else if ((Object.keys({ ...this.config, ...config }) as (keyof GestureConfig)[])
      .some(key => key !== 'pointerGain' && config[key] !== this.config[key])) this.cancel('Movement calibration changed; confirm open palm')
    this.config = { ...config }
    return this.snapshot = this.wrap(this.pointer.configure(config))
  }

  cancel(reason = 'Tracking stopped'): ClickSnapshot {
    const wait = this.pending() || this.clickDiagnostics.state === 'WAIT_FOR_RELEASE' || this.clickDiagnostics.state === 'CLICK'
    if (this.pending()) { this.clickDiagnostics.rejectedAttempts++; this.clickDiagnostics.lastCancellation = reason }
    this.lock = null; this.focusId = null; this.focusedTarget = null; this.anchor = null; this.frame = null; this.pendingAck = null
    this.clickDiagnostics.pose = 'UNKNOWN'
    this.clickDiagnostics.state = wait ? 'WAIT_FOR_RELEASE' : 'OPEN'
    this.clickDiagnostics.progress = 0; this.clickDiagnostics.targetLocked = false; this.clickDiagnostics.lockedTargetId = null
    const result = this.pointer.cancel(reason); this.diagnostics = { ...this.pointer.diagnostics }
    return this.snapshot = this.wrap(result)
  }

  recenterPointer(): ClickSnapshot {
    this.cancel('Pointer recentered')
    const result = this.pointer.recenterPointer()
    this.diagnostics = { ...this.pointer.diagnostics }
    return this.snapshot = this.wrap(result)
  }

  retainPointerGeometry(point: Point2, viewport: {width:number;height:number}): ClickSnapshot {
    this.cancel('Spatial interaction released')
    const result=this.pointer.retainPointerGeometry(point,viewport)
    this.diagnostics={...this.pointer.diagnostics}
    return this.snapshot=this.wrap(result)
  }

  update(frame: InteractionFrame, receivedAt: number): ClickSnapshot {
    const time = frame.timestampMs, hand = frame.hands[0]
    if (!Number.isFinite(time) || !Number.isFinite(receivedAt) || time < 0 || receivedAt < time || receivedAt - time > this.config.freshnessMs ||
      this.frame && (time <= this.frame.timestampMs || time - this.frame.timestampMs > this.config.freshnessMs)) return this.cancel('Stale, missing or nonmonotonic observation')
    if (frame.ambiguous || frame.hands.length !== 1) return this.cancel(frame.ambiguous ? frame.reason : 'One tracked hand required')
    if (hand.timestampMs !== time || !Number.isFinite(hand.center.x) || !Number.isFinite(hand.center.y) || hand.center.x < 0 || hand.center.x > 1 || hand.center.y < 0 || hand.center.y > 1 ||
      !Number.isFinite(frame.viewport.width + frame.viewport.height) || frame.viewport.width <= 0 || frame.viewport.height <= 0 || new Set(frame.targets.map(t => t.id)).size !== frame.targets.length) return this.cancel('Invalid observation or duplicate targets')
    if (this.frame && (this.frame.viewport.width !== frame.viewport.width || this.frame.viewport.height !== frame.viewport.height)) return this.cancel('Viewport changed')
    if (this.frame && this.frame.hands[0]?.id !== hand.id) { this.cancel('Tracked hand identity changed'); this.frame = frame; return this.snapshot }
    this.frame = frame
    this.clickDiagnostics.pose = hand.pose
    this.diagnostics = { ...this.diagnostics, raw: hand.pose === 'OPEN' ? 'OPEN' : hand.pose === 'UNKNOWN' ? 'UNKNOWN' : 'OTHER',
      handId: hand.id, quality: frame.reason, observationAgeMs: receivedAt - time }
    if (this.clickDiagnostics.state === 'CLICK') this.clickDiagnostics.state = 'WAIT_FOR_RELEASE'

    if (this.clickDiagnostics.state === 'WAIT_FOR_RELEASE') {
      if (hand.pose === 'OPEN') {
        const base = this.pointer.update(frame, receivedAt); this.diagnostics = { ...this.pointer.diagnostics }
        if (this.diagnostics.confirmed) {
          this.lock = null; this.clickDiagnostics.state = 'OPEN'; this.focusId = null
          return this.observeOpen(base, receivedAt)
        }
        return this.snapshot = this.wrap(base)
      }
      this.pointer.cancel('Open hand to release')
      if (this.lock && !this.targetValid(frame.targets)) this.lock = null
      return this.freeze('Open your hand before the next click')
    }

    if (this.pending()) return this.close(frame, receivedAt)
    if (this.clickDiagnostics.state === 'TARGET_FOCUSED' && hand.pose !== 'OPEN' && this.anchor) {
      const target = frame.targets.find(t => t.id === this.focusId)
      if (!target || target.disabled || target.kind !== 'click' || target.activationToken === undefined || !this.focusedTarget) return this.cancel('Focused target is no longer eligible')
      this.lock = { target: this.focusedTarget, handId: hand.id, anchor: { ...this.anchor }, started: time, fistSince: null, frozen: this.snapshot }
      this.clickDiagnostics.state = 'FIST_TRANSITION'
      this.pointer.cancel('Target locked for closure')
      this.diagnostics.confirmed = false
      return this.close(frame, receivedAt)
    }
    const base = this.pointer.update(frame, receivedAt); this.diagnostics = { ...this.pointer.diagnostics }
    return this.observeOpen(base, receivedAt)
  }

  tick(now: number, targets?: InteractionTarget[]): ClickSnapshot {
    if (this.clickDiagnostics.state === 'CLICK') this.clickDiagnostics.state = 'WAIT_FOR_RELEASE'
    if (this.frame && now - this.frame.timestampMs > this.config.freshnessMs) return this.cancel('Observation expired during interaction')
    if (this.lock && targets && !this.targetValid(targets)) {
      if (this.pending()) return this.cancel('Locked target removed, disabled, replaced or moved')
      this.lock = null
    }
    if (this.pending()) {
      if (this.lock!.fistSince === null && now - this.lock!.started > this.clickConfig.uncertaintyMs || now - this.lock!.started > this.clickConfig.uncertaintyMs + this.clickConfig.fistConfirmationMs) return this.cancel('Closing uncertainty expired')
      return this.freeze('Hold a complete fist to confirm')
    }
    if (this.clickDiagnostics.state === 'WAIT_FOR_RELEASE' && !this.diagnostics.confirmed) {
      if (this.config.pointerPreview && this.clickDiagnostics.pose === 'OPEN') {
        const base = this.pointer.tick(now); this.diagnostics = { ...this.pointer.diagnostics }
        // Preview movement cannot clear release lockout or count as OPEN dwell.
        return this.snapshot = this.wrap(base)
      }
      return this.freeze('Open your hand before the next click')
    }
    const base = this.pointer.tick(now); this.diagnostics = { ...this.pointer.diagnostics }
    return this.observeOpen(base, now)
  }

  acknowledge(sequence: number, accepted: boolean, now: number) {
    if (!this.pendingAck || sequence !== this.pendingAck.sequence) return
    if (accepted) { this.clickDiagnostics.validClicks++; this.clickDiagnostics.lastGestureLatencyMs = now - this.pendingAck.since }
    else { this.clickDiagnostics.rejectedAttempts++; this.clickDiagnostics.lastCancellation = 'Registered action rejected at dispatch' }
    this.pendingAck = null
  }

  private pending() { return this.clickDiagnostics.state === 'FIST_TRANSITION' || this.clickDiagnostics.state === 'FIST_CONFIRMED' }
  private targetValid(targets: InteractionTarget[]) {
    const original = this.lock!.target, current = targets.find(t => t.id === original.id)
    return !!current && !current.disabled && current.kind === 'click' && current.activationToken === original.activationToken &&
      (Object.keys(original.rect) as (keyof typeof original.rect)[]).every(key => current.rect[key] === original.rect[key])
  }

  private close(frame: InteractionFrame, receivedAt: number): ClickSnapshot {
    const lock = this.lock!, hand = frame.hands[0], time = frame.timestampMs
    if (hand.id !== lock.handId || !this.targetValid(frame.targets)) return this.cancel('Locked identity or target changed')
    if (Math.hypot(hand.center.x - lock.anchor.x, hand.center.y - lock.anchor.y) > this.clickConfig.maxPalmTravel) return this.cancel('Palm moved too far during closure')
    if (hand.pose === 'OPEN') return this.cancel('Hand reopened before fist confirmation')
    if (hand.pose === 'UNKNOWN') {
      lock.fistSince = null; this.clickDiagnostics.progress = 0
      if (time - lock.started > this.clickConfig.uncertaintyMs) return this.cancel('Closing uncertainty expired')
      return this.freeze('Closing hand; waiting for all four fingers')
    }
    if (lock.fistSince === null) {
      if (time - lock.started > this.clickConfig.uncertaintyMs) return this.cancel('Closing uncertainty expired')
      lock.fistSince = time
    }
    if (time - lock.started > this.clickConfig.uncertaintyMs + this.clickConfig.fistConfirmationMs) return this.cancel('Closing deadline expired')
    this.clickDiagnostics.progress = Math.min(1, (time - lock.fistSince) / this.clickConfig.fistConfirmationMs)
    if (time - lock.fistSince < this.clickConfig.fistConfirmationMs) return this.freeze('Hold a complete fist to confirm')
    this.clickDiagnostics.state = 'FIST_CONFIRMED'
    const activation = { id: lock.target.id, token: lock.target.activationToken!, sequence: ++this.sequence }
    this.clickDiagnostics.lastConfirmationMs = time - lock.fistSince
    this.pendingAck = { sequence: activation.sequence, since: lock.fistSince }
    this.clickDiagnostics.state = 'CLICK'
    this.snapshot = { ...this.freeze('Activated once; open your hand to release'), activation, clickId: activation.id }
    this.diagnostics.observationAgeMs = receivedAt - time
    return this.snapshot
  }

  private observeOpen(base: InteractionSnapshot, now: number): ClickSnapshot {
    this.clickDiagnostics.progress = 0
    if (!this.diagnostics.confirmed || !base.focusId) { this.focusId = null; this.clickDiagnostics.state = 'OPEN' }
    else {
      const target = this.frame?.targets.find(t => t.id === base.focusId)
      if (base.focusId !== this.focusId || target?.activationToken !== this.focusedTarget?.activationToken) { this.focusId = base.focusId; this.focusSince = now }
      this.focusedTarget = target ? { ...target, rect: { ...target.rect } } : null
      this.clickDiagnostics.state = target?.activationToken !== undefined && target.kind === 'click' && now - this.focusSince >= this.clickConfig.focusStableMs ? 'TARGET_FOCUSED' : 'OPEN'
      this.anchor = this.frame?.hands[0]?.center ?? null
    }
    return this.snapshot = this.wrap(base)
  }

  private freeze(reason: string): ClickSnapshot {
    const base = this.lock ? { ...this.lock.frozen, reason } : { ...this.snapshot, mode: 'UNCERTAIN' as const, focusId: null, pointer: null, proximity: {}, reason }
    return this.snapshot = this.wrap({ ...base, clickId: null, drag: null, scrollVelocity: 0 })
  }

  private wrap(base: InteractionSnapshot): ClickSnapshot {
    this.clickDiagnostics.targetLocked = this.lock !== null; this.clickDiagnostics.lockedTargetId = this.lock?.target.id ?? null
    return { ...base, activation: null, clickId: null, targetLocked: this.lock !== null, clickState: this.clickDiagnostics.state, confirmationProgress: this.clickDiagnostics.progress }
  }
}
