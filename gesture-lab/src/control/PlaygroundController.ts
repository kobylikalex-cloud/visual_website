import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import { HandTracker } from './HandTracker.ts'
import type { GestureProfile } from './GestureProfile.ts'
import { InteractionEngine } from './InteractionEngine.ts'
import type { InteractionSnapshot, InteractionTarget, Point2, TrackingFrame, TrackingResult } from './types.ts'

export type PlaygroundEffects = {
  activate(id: string): void
  dragBy(delta: Point2): void
  scrollBy(deltaY: number): void
}

/** Page-only effect boundary. No native cursor, general DOM click, or window scrolling. */
export class PlaygroundController {
  private tracker: HandTracker
  private engine: InteractionEngine
  private config: GestureConfig
  private effects: PlaygroundEffects
  private enabled = true
  private lastTick: number | null = null
  private tracking: TrackingResult = { hands: [], ambiguous: false, reason: 'Camera off' }
  private profile: GestureProfile | null = null

  constructor(effects: PlaygroundEffects = { activate() {}, dragBy() {}, scrollBy() {} }, config = DEFAULT_GESTURE_CONFIG) {
    this.effects = effects
    this.config = { ...config }
    this.tracker = new HandTracker(this.config)
    this.engine = new InteractionEngine(this.config)
  }

  setEffects(effects: PlaygroundEffects): void { this.effects = effects }

  configure(config: GestureConfig): InteractionSnapshot {
    this.config = { ...config }
    this.tracker = new HandTracker(this.config, this.profile)
    this.engine = new InteractionEngine(this.config)
    return this.cancel()
  }

  setProfile(profile: GestureProfile | null): InteractionSnapshot {
    this.profile = profile
    this.tracker = new HandTracker(this.config, this.profile)
    this.engine = new InteractionEngine(this.config)
    return this.cancel()
  }

  setEnabled(enabled: boolean): InteractionSnapshot {
    this.enabled = enabled
    return this.cancel()
  }

  cancel(): InteractionSnapshot {
    this.tracker.reset()
    this.tracking = { hands: [], ambiguous: false, reason: 'Waiting for a clear hand' }
    this.lastTick = null
    return this.engine.reset()
  }

  getTracking(): TrackingResult { return this.tracking }

  update(frame: TrackingFrame, targets: InteractionTarget[], viewport: { width: number; height: number }, receivedAt = frame.timestampMs): InteractionSnapshot {
    if (!this.enabled || frame.evaluationOnly || !Number.isFinite(receivedAt) ||
      receivedAt < frame.timestampMs || receivedAt - frame.timestampMs > this.config.freshnessMs) {
      const snapshot = this.cancel()
      return { ...snapshot, reason: frame.evaluationOnly ? 'Evaluation only — actions paused' : !this.enabled ? 'Gestures paused' : 'Late tracking frame' }
    }
    this.tracking = this.tracker.update(frame)
    const snapshot = this.engine.update({ ...this.tracking, timestampMs: frame.timestampMs, targets, viewport })
    // Defense in depth: dispatch only against targets still eligible in this exact frame.
    if (snapshot.clickId && targets.some(target => target.id === snapshot.clickId && target.kind === 'click' && !target.disabled)) {
      this.effects.activate(snapshot.clickId)
    }
    if (snapshot.drag && targets.some(target => target.id === snapshot.drag?.id && target.kind === 'drag' && !target.disabled)) {
      this.effects.dragBy({ x: snapshot.drag.deltaX, y: snapshot.drag.deltaY })
    }
    return snapshot
  }

  tick(nowMs: number): InteractionSnapshot {
    const snapshot = this.engine.tick(nowMs)
    const dt = this.lastTick === null || !Number.isFinite(nowMs) ? 0 : Math.max(0, Math.min(50, nowMs - this.lastTick))
    this.lastTick = Number.isFinite(nowMs) ? nowMs : null
    if (this.enabled && dt > 0 && snapshot.scrollVelocity !== 0) {
      this.effects.scrollBy(snapshot.scrollVelocity * dt / 1000)
    }
    return this.enabled ? snapshot : { ...snapshot, reason: 'Gestures paused' }
  }
}
