import { TOUCHPAD_GESTURE_CONFIG, type GestureConfig } from '../control/GestureConfig.ts'
import { AdaptivePointerFilter } from '../control/AdaptivePointerFilter.ts'
import type { Point2, TrackedHand } from '../control/types.ts'
import type { CanvasRect, DepthReading, SpatialHit, SpatialInput, SpatialScenePort, SpatialSnapshot, SpatialTick, Vec3 } from './types.ts'

/** Positive relative scale means closer to the camera, hence positive scene Z. */
export const SPATIAL_DEPTH_GAIN = 3
/** Filter speed tuning uses 120 screen-pixel equivalents per world depth unit. */
export const SPATIAL_DEPTH_PIXELS_PER_UNIT = 120
const MAX_CLOSING_PALM_TRAVEL = .08
const finitePoint = (p: Point2) => Number.isFinite(p.x) && Number.isFinite(p.y)
const finiteVec = (p: Vec3) => finitePoint(p) && Number.isFinite(p.z)
const sameRect = (a: CanvasRect, b: CanvasRect) => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
const validRect = (r: CanvasRect) => [r.left, r.top, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const copyHit = (hit: SpatialHit): SpatialHit => ({ ...hit, point: { ...hit.point }, position: { ...hit.position } })
type Focus = { hit: SpatialHit; rect: CanvasRect; since: number; ready: boolean; handId: number; palm: Point2; pointer: Point2 }
type Pending = Focus & { started: number; fistSince: number | null }
type Grab = Focus & {
  previousPalm: Point2; targetPointer: Point2; renderedPointer: Point2; grip: Vec3
  targetPlaneZ: number; renderedPlaneZ: number; depthAnchor: number | null; depthBaseZ: number
}

/** Standalone spatial ownership; never dispatches an ordinary click or scroll. */
export class SpatialInteractionEngine {
  private port: SpatialScenePort
  private config: GestureConfig
  private xyFilter: AdaptivePointerFilter
  private zFilter: AdaptivePointerFilter
  private focus: Focus | null = null
  private pending: Pending | null = null
  private grab: Grab | null = null
  private retainedPointer: Point2 | null = null
  private lastSource = -Infinity
  private lastReceived = -Infinity
  private lastRender = -Infinity
  private observed: { handId: number; viewport: { width: number; height: number } } | null = null
  private data: SpatialSnapshot

  constructor(port: SpatialScenePort, config: GestureConfig = TOUCHPAD_GESTURE_CONFIG) {
    this.port = port; this.config = this.checkedConfig(config)
    this.xyFilter = this.makeFilter(); this.zFilter = this.makeFilter()
    this.data = {
      state: 'IDLE', selectedId: null, handId: null, ready: false, exclusive: false,
      position: { ...port.getPosition() }, rawPalm: null, filteredPalm: null,
      depth: { valid: false, scale: null, relative: 0, neutralScale: null, quality: 'none', reason: 'No observation' },
      reason: 'Confirm OPEN over the cube', confirmationProgress: 0, grabCount: 0,
    }
  }

  /** filteredPalm is the last rendered screen-pixel pointer, never raw normalized palm data. */
  get snapshot(): SpatialSnapshot {
    return { ...this.data, position: { ...this.data.position }, depth: { ...this.data.depth },
      rawPalm: this.data.rawPalm ? { ...this.data.rawPalm } : null,
      filteredPalm: this.data.filteredPalm ? { ...this.data.filteredPalm } : null }
  }

  wouldConsume(pose: TrackedHand['pose']): boolean {
    return this.pending !== null || this.grab !== null || this.focus?.ready === true && pose !== 'OPEN'
  }

  /** Publish source observations to filters; transforms belong exclusively to tick(). */
  update(input: SpatialInput): SpatialSnapshot {
    const time = input.timestampMs, receivedAt = input.receivedAt, previousTime = this.lastSource
    if (!Number.isFinite(time) || !Number.isFinite(receivedAt) || time < 0 || time <= previousTime
      || receivedAt < time || receivedAt - time > this.config.freshnessMs
      || receivedAt < Math.max(this.lastReceived, this.lastRender)) return this.cancel('Stale or nonmonotonic observation')
    this.lastSource = time; this.lastReceived = receivedAt
    if (previousTime !== -Infinity && time - previousTime > this.config.freshnessMs) return this.cancel('Observation gap')
    if (input.ambiguous || input.hands.length !== 1) return this.cancel('Exactly one unambiguous hand required')
    const hand = input.hands[0], viewport = input.viewport
    if (hand.timestampMs !== time || !Number.isFinite(hand.id) || !finitePoint(hand.center)
      || hand.center.x < 0 || hand.center.x > 1 || hand.center.y < 0 || hand.center.y > 1
      || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0
      || input.base.pointer !== null && !finitePoint(input.base.pointer)) return this.cancel('Invalid observation geometry')
    if (this.observed && (hand.id !== this.observed.handId || viewport.width !== this.observed.viewport.width
      || viewport.height !== this.observed.viewport.height)) return this.cancel('Hand identity or viewport changed')
    this.observed = { handId: hand.id, viewport: { ...viewport } }
    this.data.handId = hand.id; this.data.rawPalm = { ...hand.center }
    this.data.depth = this.checkedDepth(input.depth)
    if (input.base.focusId !== null || input.base.scrollActive || input.base.scrollEntering) return this.cancel('HTML focus or scrolling owns control')
    if ((this.pending || this.grab) && !this.ownerValid()) return this.cancel('Cube owner or canvas layout changed')
    if (this.grab) {
      if (hand.pose === 'OPEN') return this.release()
      if (hand.pose !== 'FIST') return this.cancel('Uncertain pose during grab')
      return this.move(input)
    }
    if (this.pending) return this.close(input)
    if (hand.pose !== 'OPEN') {
      // Read the ready bit earned by a previous OPEN source sample; FIST cannot finish it.
      if (!this.focus?.ready) return this.cancel('Confirm OPEN over the cube before closing')
      this.pending = { ...this.focus, started: time, fistSince: null }; this.focus = null
      this.data.state = 'GRAB_PENDING'; this.data.ready = false; this.data.exclusive = true
      return this.close(input)
    }
    if (!input.base.confirmed || !input.base.pointer) return this.idle('Confirm OPEN pointer')
    const rect = this.port.getRect(), hit = this.port.pick(input.base.pointer)
    if (!validRect(rect) || !hit || !hit.id || !Number.isFinite(hit.ownerToken) || hit.ownerToken !== this.port.getOwnerToken()
      || !finiteVec(hit.point) || !finiteVec(hit.position)) return this.idle('Point OPEN at the cube')
    const stable = this.focus && this.focus.handId === hand.id && this.focus.hit.id === hit.id
      && this.focus.hit.ownerToken === hit.ownerToken && sameRect(this.focus.rect, rect)
    const since = stable ? this.focus!.since : time
    this.focus = { hit: copyHit(hit), rect: { ...rect }, since, ready: time - since >= this.config.targetLockMs,
      handId: hand.id, palm: { ...hand.center }, pointer: { ...input.base.pointer } }
    this.data.state = 'TARGET_FOCUSED'; this.data.selectedId = hit.id; this.data.ready = this.focus.ready
    this.data.exclusive = false; this.data.confirmationProgress = 0
    this.data.reason = this.focus.ready ? 'Cube ready; close into a complete fist' : 'Confirming cube focus'
    return this.snapshot
  }

  /** Source clocks determine intent/velocity; this render clock alone mutates the scene. */
  tick(now: number): SpatialTick {
    if (!Number.isFinite(now)) { this.cancel('Invalid render clock'); return { snapshot: this.snapshot, retainedPointer: null } }
    if (now < Math.max(this.lastReceived, this.lastRender)) return { snapshot: this.snapshot, retainedPointer: null }
    this.lastRender = now
    if (this.lastSource !== -Infinity && now - this.lastSource > this.config.freshnessMs) this.cancel('Observation expired')
    if ((this.focus || this.pending || this.grab) && !this.ownerValid()) this.cancel('Cube owner or canvas layout changed')
    if (this.pending && (this.pending.fistSince === null && now - this.pending.started > this.config.closingTransitionMs
      || now - this.pending.started > this.config.closingTransitionMs + this.config.graspConfirmationMs)) this.cancel('Closing uncertainty expired')
    if (this.grab) {
      const grab = this.grab
      const pointer = this.xyFilter.update(grab.targetPointer, this.lastSource, now)
      const planeZ = this.zFilter.update({ x: grab.targetPlaneZ * SPATIAL_DEPTH_PIXELS_PER_UNIT, y: 0 }, this.lastSource, now).x / SPATIAL_DEPTH_PIXELS_PER_UNIT
      const projected = this.port.planePoint(pointer, planeZ)
      if (!projected || !finiteVec(projected)) this.cancel('Projection unavailable')
      else {
        const next = this.clampPosition({ x: projected.x + grab.grip.x, y: projected.y + grab.grip.y, z: projected.z + grab.grip.z })
        if (!finiteVec(next)) this.cancel('Invalid scene position or limits')
        else {
          if (next.x !== this.data.position.x || next.y !== this.data.position.y || next.z !== this.data.position.z) this.port.setPosition({ ...next })
          this.data.position = next; this.data.filteredPalm = { ...pointer }
          grab.renderedPointer = { ...pointer }; grab.renderedPlaneZ = planeZ
        }
      }
    }
    const retainedPointer = this.retainedPointer ? { ...this.retainedPointer } : null
    this.retainedPointer = null
    return { snapshot: this.snapshot, retainedPointer }
  }

  cancel(reason = 'Spatial interaction canceled'): SpatialSnapshot {
    if (this.grab) this.retainedPointer = { ...this.grab.renderedPointer }
    else if (this.pending) this.retainedPointer = { ...this.pending.pointer }
    this.grab = null; this.pending = null; this.focus = null; this.observed = null
    this.xyFilter.reset(); this.zFilter.reset()
    this.data.state = 'UNCERTAIN'; this.data.selectedId = null; this.data.ready = false; this.data.exclusive = false
    this.data.confirmationProgress = 0; this.data.reason = reason
    return this.snapshot
  }

  configure(config: GestureConfig): SpatialSnapshot {
    const checked = this.checkedConfig(config)
    this.cancel('Spatial movement calibration changed; confirm OPEN')
    this.config = checked; this.xyFilter = this.makeFilter(); this.zFilter = this.makeFilter()
    return this.snapshot
  }

  private idle(reason: string): SpatialSnapshot {
    this.focus = null; this.data.state = 'IDLE'; this.data.selectedId = null; this.data.ready = false
    this.data.exclusive = false; this.data.confirmationProgress = 0; this.data.reason = reason
    return this.snapshot
  }

  private release(): SpatialSnapshot {
    this.cancel('OPEN released the cube at its last rendered position')
    this.data.state = 'RELEASING'
    return this.snapshot
  }

  private close(input: SpatialInput): SpatialSnapshot {
    const pending = this.pending!, hand = input.hands[0], time = input.timestampMs
    if (!this.ownerValid() || hand.id !== pending.handId) return this.cancel('Locked spatial owner changed')
    if (hand.pose === 'OPEN') return this.release()
    if (Math.hypot(hand.center.x - pending.palm.x, hand.center.y - pending.palm.y) > MAX_CLOSING_PALM_TRAVEL) return this.cancel('Palm moved too far during closure')
    if (hand.pose === 'UNKNOWN') {
      pending.fistSince = null; this.data.confirmationProgress = 0
      this.data.reason = 'Closing; waiting for all four fingers'
      return time - pending.started > this.config.closingTransitionMs ? this.cancel('Closing uncertainty expired') : this.snapshot
    }
    if (hand.pose !== 'FIST') return this.cancel('Complete fist required')
    if (pending.fistSince === null) {
      if (time - pending.started > this.config.closingTransitionMs) return this.cancel('Closing uncertainty expired')
      pending.fistSince = time
    }
    if (time - pending.started > this.config.closingTransitionMs + this.config.graspConfirmationMs) return this.cancel('Closing deadline expired')
    this.data.confirmationProgress = Math.min(1, (time - pending.fistSince) / this.config.graspConfirmationMs)
    this.data.reason = 'Hold a complete fist to grab'
    if (time - pending.fistSince < this.config.graspConfirmationMs) return this.snapshot
    const position = this.port.getPosition(), point = pending.hit.point
    if (!finiteVec(position)) return this.cancel('Cube position unavailable')
    this.grab = {
      ...pending, hit: copyHit(pending.hit), previousPalm: { ...hand.center }, targetPointer: { ...pending.pointer }, renderedPointer: { ...pending.pointer },
      grip: { x: position.x - point.x, y: position.y - point.y, z: position.z - point.z },
      targetPlaneZ: point.z, renderedPlaneZ: point.z, depthBaseZ: point.z,
      depthAnchor: this.data.depth.valid ? this.data.depth.relative : null,
    }
    this.xyFilter.reset(); this.zFilter.reset()
    this.xyFilter.update(pending.pointer, time, input.receivedAt)
    this.zFilter.update({ x: point.z * SPATIAL_DEPTH_PIXELS_PER_UNIT, y: 0 }, time, input.receivedAt)
    this.pending = null; this.data.position = { ...position }; this.data.filteredPalm = { ...pending.pointer }
    this.data.state = 'GRABBING_3D'; this.data.exclusive = true; this.data.ready = false
    this.data.grabCount++; this.data.reason = 'FIST moving cube in X/Y with reliable relative depth'
    return this.snapshot
  }

  private move(input: SpatialInput): SpatialSnapshot {
    const grab = this.grab!, palm = input.hands[0].center
    grab.targetPointer = {
      x: clamp(grab.targetPointer.x + (grab.previousPalm.x - palm.x) * this.config.pointerGain
        / (this.config.pointerMaxX - this.config.pointerMinX) * input.viewport.width, 0, input.viewport.width),
      y: clamp(grab.targetPointer.y + (palm.y - grab.previousPalm.y) * this.config.pointerGain
        / (this.config.pointerMaxY - this.config.pointerMinY) * input.viewport.height, 0, input.viewport.height),
    }
    grab.previousPalm = { ...palm }
    this.xyFilter.update(grab.targetPointer, input.timestampMs, input.receivedAt)
    if (!this.data.depth.valid) {
      // Discard unpublished depth and filter tail; X/Y filtering remains independent.
      grab.depthAnchor = null; grab.depthBaseZ = grab.renderedPlaneZ; grab.targetPlaneZ = grab.renderedPlaneZ
      this.zFilter.reset()
    } else {
      if (grab.depthAnchor === null) { grab.depthAnchor = this.data.depth.relative; grab.depthBaseZ = grab.renderedPlaneZ }
      const centerZ = grab.depthBaseZ + (this.data.depth.relative - grab.depthAnchor) * SPATIAL_DEPTH_GAIN + grab.grip.z
      grab.targetPlaneZ = clamp(centerZ, this.port.bounds.min.z, this.port.bounds.max.z) - grab.grip.z
    }
    this.zFilter.update({ x: grab.targetPlaneZ * SPATIAL_DEPTH_PIXELS_PER_UNIT, y: 0 }, input.timestampMs, input.receivedAt)
    return this.snapshot
  }

  private ownerValid(): boolean {
    const owner = this.grab ?? this.pending ?? this.focus
    return !owner || this.port.getOwnerToken() === owner.hit.ownerToken && sameRect(this.port.getRect(), owner.rect)
  }

  private clampPosition(p: Vec3): Vec3 {
    const { min, max } = this.port.bounds
    return { x: clamp(p.x, min.x, max.x), y: clamp(p.y, min.y, max.y), z: clamp(p.z, min.z, max.z) }
  }

  private checkedDepth(depth: DepthReading): DepthReading {
    return Number.isFinite(depth.relative) ? { ...depth } : { ...depth, valid: false, relative: 0, reason: 'Nonfinite depth rejected' }
  }

  private checkedConfig(config: GestureConfig): GestureConfig {
    if (![config.pointerGain, config.pointerSmoothingMs, config.targetLockMs, config.graspConfirmationMs, config.closingTransitionMs, config.freshnessMs,
      config.pointerMinX, config.pointerMaxX, config.pointerMinY, config.pointerMaxY].every(Number.isFinite)
      || config.pointerGain <= 0 || config.pointerSmoothingMs <= 0 || config.targetLockMs < 0 || config.graspConfirmationMs <= 0
      || config.closingTransitionMs < 0 || config.freshnessMs <= 0 || config.pointerMaxX <= config.pointerMinX || config.pointerMaxY <= config.pointerMinY) throw new RangeError('Invalid spatial movement configuration')
    return { ...config }
  }

  private makeFilter(): AdaptivePointerFilter {
    return new AdaptivePointerFilter({ baselineTimeConstantMs: this.config.pointerSmoothingMs })
  }
}
