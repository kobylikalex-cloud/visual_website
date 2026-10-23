import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import type { InteractionFrame, InteractionSnapshot, Point2, InteractionTarget } from './types.ts'
import { PointerController } from './PointerController.ts'
import { TargetSelector, distanceToTarget } from './TargetSelector.ts'
import { ScrollController } from './ScrollController.ts'

function empty(reason: string, mode: InteractionSnapshot['mode'] = 'UNCERTAIN'): InteractionSnapshot {
  return { mode, focusId: null, proximity: {}, pointer: null, clickId: null, drag: null, scrollVelocity: 0, reason }
}
type Grasp = { targetId: string; kind: InteractionTarget['kind']; since: number; origin: Point2; last: Point2; confirmed: boolean }
type ClosingBridge = { handId: number; targetId: string; kind: InteractionTarget['kind']; origin: Point2; deadlineMs: number }

/** A pure page-only intent reducer. Each output effect is safe to consume once. */
export class InteractionEngine {
  private config: GestureConfig
  private pointer: PointerController
  private selector: TargetSelector
  private scroll: ScrollController
  private snapshot = empty('No hands', 'IDLE')
  private lastFrameMs: number | null = null
  private clockMs: number | null = null
  private ids: number[] = []
  private handTimes = new Map<number, number>()
  private controllingId: number | null = null
  private openSince: number | null = null
  private lastOpenPoint: Point2 | null = null
  private viewport: InteractionFrame['viewport'] | null = null
  private armed = false
  private grasp: Grasp | null = null
  private focusId: string | null = null
  private closingBridge: ClosingBridge | null = null

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) {
    this.config = { ...config }
    this.pointer = new PointerController(this.config)
    this.selector = new TargetSelector(this.config)
    this.scroll = new ScrollController(this.config)
  }

  private clearIntent() {
    this.pointer.reset(); this.selector.reset(); this.scroll.reset()
    this.controllingId = null; this.openSince = null; this.lastOpenPoint = null; this.armed = false; this.grasp = null
    this.focusId = null; this.closingBridge = null
  }

  private stop(reason: string, mode: InteractionSnapshot['mode'] = 'UNCERTAIN'): InteractionSnapshot {
    this.clearIntent()
    this.snapshot = empty(reason, mode)
    return this.snapshot
  }

  reset(): InteractionSnapshot {
    this.ids = []; this.handTimes.clear(); this.lastFrameMs = null; this.clockMs = null; this.viewport = null
    return this.stop('Reset', 'IDLE')
  }

  tick(nowMs: number): InteractionSnapshot {
    if (!Number.isFinite(nowMs) || (this.clockMs !== null && nowMs < this.clockMs)) return this.stop('Invalid clock')
    this.clockMs = nowMs
    if (this.closingBridge && nowMs >= this.closingBridge.deadlineMs) return this.stop('Closing transition expired')
    if ((this.lastFrameMs !== null && nowMs - this.lastFrameMs > this.config.freshnessMs) ||
      [...this.handTimes.values()].some(timestamp => nowMs - timestamp > this.config.freshnessMs)) return this.stop('Tracking stale')
    this.snapshot = { ...this.snapshot, clickId: null, drag: null }
    return this.snapshot
  }

  private valid(frame: InteractionFrame): boolean {
    const finite = Number.isFinite
    if (!finite(frame.timestampMs) || frame.timestampMs < 0 || frame.ambiguous || frame.hands.length > 2 ||
      !finite(frame.viewport.width) || !finite(frame.viewport.height) || frame.viewport.width <= 0 || frame.viewport.height <= 0) return false
    if (this.lastFrameMs !== null && frame.timestampMs <= this.lastFrameMs) return false
    if (this.clockMs !== null && this.clockMs - frame.timestampMs > this.config.freshnessMs) return false
    if (new Set(frame.hands.map(hand => hand.id)).size !== frame.hands.length) return false
    if (new Set(frame.targets.map(target => target.id)).size !== frame.targets.length) return false
    if (frame.targets.some(target => !target.id || !['click', 'drag'].includes(target.kind) ||
      ![target.rect.left, target.rect.top, target.rect.width, target.rect.height].every(finite) || target.rect.width < 0 || target.rect.height < 0)) return false
    return frame.hands.every(hand => finite(hand.id) && finite(hand.center.x) && finite(hand.center.y) &&
      hand.center.x >= 0 && hand.center.x <= 1 && hand.center.y >= 0 && hand.center.y <= 1 &&
      finite(hand.timestampMs) && hand.timestampMs <= frame.timestampMs && frame.timestampMs - hand.timestampMs <= this.config.freshnessMs &&
      (this.handTimes.get(hand.id) === undefined || hand.timestampMs > this.handTimes.get(hand.id)!) &&
      ['OPEN', 'FIST', 'UNKNOWN'].includes(hand.pose) && ['UPRIGHT_LIKE', 'FLAT_LIKE', 'TRANSITION'].includes(hand.orientation))
  }

  update(frame: InteractionFrame): InteractionSnapshot {
    if (!this.valid(frame)) return this.stop(frame.ambiguous ? 'Tracking ambiguous' : 'Invalid frame')
    const now = frame.timestampMs
    const ids = frame.hands.map(hand => hand.id).sort((a, b) => a - b)
    const identityChanged = this.ids.length !== ids.length || ids.some((id, i) => id !== this.ids[i])
    const gap = this.lastFrameMs !== null && now - this.lastFrameMs > this.config.freshnessMs
    const resized = this.viewport !== null && (this.viewport.width !== frame.viewport.width || this.viewport.height !== frame.viewport.height)
    if (identityChanged || gap || resized) this.clearIntent()
    this.viewport = { ...frame.viewport }
    this.ids = ids; this.lastFrameMs = now; this.clockMs = Math.max(this.clockMs ?? now, now)
    this.handTimes = new Map(frame.hands.map(hand => [hand.id, hand.timestampMs]))
    this.snapshot = empty('Confirm a gesture')
    if (!frame.hands.length) return this.stop('No hands', 'IDLE')
    // Recognition remains UNKNOWN through finger dead bands. A previously armed
    // target can wait briefly, but UNKNOWN itself never produces an effect.
    if (this.closingBridge && frame.hands.some(hand => hand.pose === 'OPEN')) this.clearIntent()
    if (frame.hands.some(hand => hand.pose === 'UNKNOWN')) {
      const hand = frame.hands[0]
      if (frame.hands.length !== 1 || hand.orientation !== 'UPRIGHT_LIKE' || this.grasp) return this.stop('Pose or orientation uncertain')
      if (!this.closingBridge) {
        if (!this.armed || this.controllingId !== hand.id || !this.selector.isLocked(now) || !this.lastOpenPoint) return this.stop('Pose or orientation uncertain')
        const target = frame.targets.find(target => target.id === this.focusId && !target.disabled)
        if (!target) return this.stop('Closing target unavailable')
        this.closingBridge = { handId: hand.id, targetId: target.id, kind: target.kind, origin: { ...this.lastOpenPoint }, deadlineMs: now + this.config.closingTransitionMs }
      }
      const bridge = this.closingBridge
      const raw = this.pointer.project(hand.center, frame.viewport)
      const target = frame.targets.find(target => target.id === bridge.targetId && target.kind === bridge.kind && !target.disabled)
      if (now >= bridge.deadlineMs || bridge.handId !== hand.id || !target ||
        distanceToTarget(raw, target) > this.config.targetExitRadius ||
        Math.hypot(raw.x - bridge.origin.x, raw.y - bridge.origin.y) > this.config.targetExitRadius) return this.stop('Closing transition cancelled')
      this.armed = false; this.openSince = null; this.scroll.reset()
      this.snapshot = { ...empty('Waiting for confirmed fist', 'GRASP_PENDING'), focusId: bridge.targetId }
      return this.snapshot
    }
    if (frame.hands.some(hand => hand.pose === 'OPEN' && hand.orientation === 'TRANSITION')) return this.stop('Pose or orientation uncertain')
    if (this.closingBridge) {
      const bridge = this.closingBridge
      const hand = frame.hands[0]
      const raw = this.pointer.project(hand.center, frame.viewport)
      const target = frame.targets.find(target => target.id === bridge.targetId && target.kind === bridge.kind && !target.disabled)
      if (frame.hands.length !== 1 || hand.id !== bridge.handId || hand.pose !== 'FIST' || hand.orientation !== 'UPRIGHT_LIKE' ||
        now >= bridge.deadlineMs || !target || distanceToTarget(raw, target) > this.config.targetExitRadius ||
        Math.hypot(raw.x - bridge.origin.x, raw.y - bridge.origin.y) > this.config.targetExitRadius) return this.stop('Closing transition cancelled')
      // Only the first actual FIST frame starts the complete confirmation interval.
      this.grasp = { targetId: bridge.targetId, kind: bridge.kind, since: now, origin: raw,
        last: this.pointer.update(hand.center, now, frame.viewport), confirmed: false }
      this.closingBridge = null
    }

    if (frame.hands.every(hand => hand.pose === 'OPEN' && hand.orientation === 'FLAT_LIKE')) {
      this.pointer.reset(); this.selector.reset(); this.controllingId = null; this.openSince = null; this.armed = false; this.grasp = null
      const result = this.scroll.update(frame.hands, now)
      this.snapshot = { ...empty(result.confirmed ? 'Flat hand controls scroll' : 'Confirming flat hand'),
        mode: result.confirmed ? (frame.hands.length === 2 ? 'SCROLL_FAST' : 'SCROLL') : 'UNCERTAIN', scrollVelocity: result.velocity }
      return this.snapshot
    }
    this.scroll.reset()
    if (frame.hands.length !== 1) return this.stop('Two hands require flat agreement')
    const hand = frame.hands[0]
    if (this.controllingId !== null && this.controllingId !== hand.id) return this.stop('Controlling hand changed')

    if (hand.pose === 'OPEN' && hand.orientation === 'UPRIGHT_LIKE') {
      if (this.grasp) this.clearIntent()
      this.controllingId = hand.id
      if (this.openSince === null) this.openSince = now
      if (now - this.openSince < this.config.confirmationMs) return this.snapshot
      this.armed = true
      const pointer = this.pointer.update(hand.center, now, frame.viewport)
      this.lastOpenPoint = this.pointer.project(hand.center, frame.viewport)
      const selection = this.selector.update(pointer, frame.targets, now)
      this.focusId = selection.focusId
      this.snapshot = { ...empty('Open hand points', 'POINTER'), ...selection, pointer }
      return this.snapshot
    }

    if (hand.pose !== 'FIST') return this.stop('Unsupported gesture')
    this.openSince = null
    if (!this.grasp) {
      if (!this.armed || !this.selector.isLocked(now)) return this.stop('Open and focus before grasping')
      const raw = this.pointer.project(hand.center, frame.viewport)
      // The last open-hand selection is the only eligible grasp target.
      const selection = this.selector.update(this.pointer.update(hand.center, now, frame.viewport), frame.targets, now)
      const target = frame.targets.find(target => target.id === selection.focusId && !target.disabled)
      if (!target || !this.selector.isLocked(now)) return this.stop('Target not stable')
      if (target.kind === 'click' && this.lastOpenPoint !== null &&
        Math.hypot(raw.x - this.lastOpenPoint.x, raw.y - this.lastOpenPoint.y) > this.config.targetExitRadius) return this.stop('Click motion cancelled')
      this.grasp = { targetId: target.id, kind: target.kind, since: now, origin: raw, last: this.pointer.update(hand.center, now, frame.viewport), confirmed: false }
      this.armed = false
    }
    const grasp = this.grasp
    const target = frame.targets.find(target => target.id === grasp.targetId && !target.disabled && target.kind === grasp.kind)
    if (!target) return this.stop('Grasp target unavailable')
    const raw = this.pointer.project(hand.center, frame.viewport)
    if (grasp.kind === 'click' && (distanceToTarget(raw, target) > this.config.targetExitRadius ||
      Math.hypot(raw.x - grasp.origin.x, raw.y - grasp.origin.y) > this.config.targetExitRadius)) return this.stop('Click motion cancelled')
    const pointer = this.pointer.update(hand.center, now, frame.viewport)
    if (!grasp.confirmed && now - grasp.since < this.config.graspConfirmationMs) {
      this.snapshot = { ...empty('Confirming fist', 'GRASP_PENDING'), pointer, focusId: grasp.targetId }
      return this.snapshot
    }
    if (grasp.kind === 'click') {
      this.grasp = null
      this.snapshot = { ...empty('Click complete; reopen to rearm'), focusId: grasp.targetId, clickId: grasp.targetId }
      return this.snapshot
    }
    const drag = grasp.confirmed ? { id: grasp.targetId, deltaX: pointer.x - grasp.last.x, deltaY: pointer.y - grasp.last.y } : null
    grasp.confirmed = true; grasp.last = pointer
    this.snapshot = { ...empty('Fist drags', 'GRABBING'), focusId: grasp.targetId, pointer, drag }
    return this.snapshot
  }
}
