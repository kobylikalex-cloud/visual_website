import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import { FistClickEngine, type ClickSnapshot } from './FistClickEngine.ts'
import type { PointerDiagnostics } from './OpenPointerEngine.ts'
import { PageScrollSession, DEFAULT_PAGE_SCROLL_CONFIG, type PageScrollConfig, type ScrollSessionSnapshot } from './PageScrollSession.ts'
import { calibrateFlatPose, classifyScrollPose, DEFAULT_SCROLL_POSE, type PoseSample } from './ScrollPoseProfile.ts'
import type { InteractionFrame, InteractionTarget } from './types.ts'

export type PageInteractionState = 'POINTER_MODE' | 'CLICK_CONFIRMATION' | 'SCROLL_ENTRY' | 'SCROLL_ACTIVE' | 'UNCERTAIN' | 'INACTIVE'
export type PageGestureSnapshot = ClickSnapshot & { interactionState: PageInteractionState; scrollDeltaY: number }
type ScrollObservation = { time: number; sourceTime: number; sourceAgeMs: number; hands: number; ambiguous: boolean;
  handId: number|null; pose: string; height: number|null; depth: number|null; facing: number|null;
  mode: PageInteractionState; scrollState: ScrollSessionSnapshot['state']; neutralY: number|null; velocity: number; reason: string }

/** Exclusive routing around the protected pointer/click engine, no DOM effects. */
export class PageGestureEngine {
  private click: FistClickEngine
  private scroll = new PageScrollSession()
  private scrollConfig = { ...DEFAULT_PAGE_SCROLL_CONFIG }
  private profile = { ...DEFAULT_SCROLL_POSE }
  private config: GestureConfig
  private frame: InteractionFrame | null = null
  private lastTimestamp = -Infinity
  private scrollEngaged = false
  private automaticScroll = true
  private uprightSince: number | null = null
  private now = 0
  private samples: PoseSample[] = []
  private scrollView: ScrollSessionSnapshot = this.scroll.reset()
  private snapshot: PageGestureSnapshot
  private transitions: { state: PageInteractionState; reason: string; time: number }[] = []
  private transitionCount = 0
  private debugTrace = false
  private observations: ScrollObservation[] = []

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) {
    this.config = { ...config }; this.click = new FistClickEngine(config)
    this.snapshot = { ...this.click.cancel('Start camera to begin.'), interactionState: 'INACTIVE', scrollDeltaY: 0 }
  }

  get diagnostics(): PointerDiagnostics {
    if (!this.scrollEngaged) return this.click.diagnostics
    const h = this.frame?.hands[0]
    return { raw: h?.pose === 'OPEN' ? 'OPEN' : 'UNKNOWN', confirmed: false, handId: h?.id ?? null,
      quality: this.scrollView.reason, distance: null, observationAgeMs: h ? this.now - h.timestampMs : null }
  }
  get clickDiagnostics() { return { ...this.click.clickDiagnostics, pose: this.frame?.hands[0]?.pose ?? 'UNKNOWN' as const } }
  get scrollDiagnostics() {
    return { ...this.scrollView, reason: this.snapshot.reason, mode: this.snapshot.interactionState, automaticScroll: this.automaticScroll, profile: { ...this.profile }, config: { ...this.scrollConfig },
      metrics: this.frame?.hands[0]?.orientationMetrics ?? null, transitionCount: this.transitionCount, transitions: [...this.transitions],
      observations: this.observations.map(observation=>({...observation})) }
  }
  setDebugTrace(enabled: boolean) { this.debugTrace=enabled; this.observations=[] }

  configure(config: GestureConfig) {
    this.config = { ...config }
    if (this.scrollEngaged) this.cancel('Pointer calibration changed')
    return this.publish(this.click.configure(config))
  }
  configureScroll(config: PageScrollConfig) {
    const session = new PageScrollSession(config) // validate before mutating
    this.cancel('Scroll settings changed'); this.scroll = session; this.scrollConfig = { ...config }
    return this.snapshot
  }
  calibrateScrollPose(now: number) {
    const profile = calibrateFlatPose(this.samples, now)
    this.cancel('Flat posture calibrated'); this.profile = profile
    return { ...profile }
  }
  restoreScrollDefaults() {
    this.profile = { ...DEFAULT_SCROLL_POSE }
    return this.configureScroll(DEFAULT_PAGE_SCROLL_CONFIG)
  }
  resetNeutral() { return this.cancel('Begin a fresh flat-hand stroke to recapture neutral') }
  setAutomaticScroll(enabled: boolean): PageGestureSnapshot {
    this.automaticScroll = enabled
    return this.cancel(enabled ? 'Automatic scrolling restored; confirm open hand' : 'Navigation-only comparison; automatic scrolling paused')
  }
  recenterPointer(): PageGestureSnapshot {
    this.cancel('Pointer recentered')
    return this.publish(this.click.recenterPointer(), 'INACTIVE')
  }
  retainPointerGeometry(point: {x:number;y:number}, viewport: {width:number;height:number}): PageGestureSnapshot {
    this.cancel('Spatial interaction released')
    return this.publish(this.click.retainPointerGeometry(point,viewport),'INACTIVE')
  }
  acknowledge(sequence: number, accepted: boolean, now: number) { this.click.acknowledge(sequence, accepted, now) }

  cancel(reason = 'Gestures stopped'): PageGestureSnapshot {
    this.scrollView = this.scroll.reset(reason); this.scrollEngaged = false; this.uprightSince = null; this.frame = null; this.samples = []
    return this.publish(this.click.cancel(reason), 'INACTIVE')
  }

  update(frame: InteractionFrame, receivedAt: number): PageGestureSnapshot {
    const result=this.observe(frame,receivedAt)
    if(this.debugTrace){
      const hand=!frame.ambiguous&&frame.hands.length===1?frame.hands[0]:null
      this.observations.push({time:receivedAt,sourceTime:frame.timestampMs,sourceAgeMs:receivedAt-frame.timestampMs,
        hands:frame.hands.length,ambiguous:frame.ambiguous,handId:hand?.id??null,pose:hand?.pose??'UNKNOWN',height:hand?.center.y??null,
        depth:hand?.orientationMetrics?.depthTiltDegrees??null,facing:hand?.orientationMetrics?.palmFacingCameraPercent??null,
        mode:result.interactionState,scrollState:this.scrollView.state,neutralY:this.scrollView.neutralY,velocity:result.scrollVelocity,reason:result.reason})
      if(this.observations.length>400)this.observations.shift()
    }
    return result
  }

  private observe(frame: InteractionFrame, receivedAt: number): PageGestureSnapshot {
    const t = frame.timestampMs, hand = frame.hands[0]
    this.now = receivedAt
    if (!Number.isFinite(t + receivedAt) || t < 0 || t <= this.lastTimestamp || receivedAt < t || receivedAt - t > this.config.freshnessMs ||
      this.frame && t - this.frame.timestampMs > this.config.freshnessMs) return this.cancel('Stale or invalid observation')
    this.lastTimestamp = t
    if (frame.ambiguous || frame.hands.length !== 1) return this.cancel(frame.ambiguous ? frame.reason : 'One tracked hand required')
    if (hand.timestampMs !== t || !Number.isFinite(hand.center.x + hand.center.y + frame.viewport.width + frame.viewport.height) ||
      hand.center.x < 0 || hand.center.x > 1 || hand.center.y < 0 || hand.center.y > 1 || frame.viewport.width <= 0 || frame.viewport.height <= 0) return this.cancel('Invalid palm or viewport')
    if (this.frame && (this.frame.hands[0].id !== hand.id || this.frame.viewport.width !== frame.viewport.width || this.frame.viewport.height !== frame.viewport.height)) {
      this.cancel('Identity or viewport changed'); this.frame = frame; return this.snapshot
    }
    this.frame = frame
    if (!this.automaticScroll) return this.publish(this.click.update(frame, receivedAt))
    this.samples.push({ timestampMs: t, handId: hand.id, pose: hand.pose, metrics: hand.orientationMetrics ?? null })
    this.samples = this.samples.filter(s => t - s.timestampMs <= 750).slice(-15)
    const pose = classifyScrollPose(hand.orientationMetrics, this.profile)
    if (this.scrollEngaged) {
      if (pose !== 'POINTER' || hand.pose !== 'OPEN') this.uprightSince = null
      if (hand.pose === 'UNKNOWN' && (pose === 'ENTER' || pose === 'RETAIN')) {
        this.scrollView = this.scroll.pause(hand, receivedAt)
        return this.publishScroll()
      }
      if (hand.pose !== 'OPEN' || pose === 'UNKNOWN') return this.cancel(hand.pose === 'FIST'
        ? 'Fist stops scrolling; reopen to aim' : 'Scroll orientation uncertain; reopen to aim')
      if (pose === 'POINTER') {
        if (this.scrollView.neutralY !== null) {
          this.uprightSince ??= t
          if (t - this.uprightSince < this.config.confirmationMs) {
            this.scrollView = this.scroll.pause(hand, receivedAt, 'Confirming upright return; scrolling paused')
            return this.publishScroll()
          }
        }
        this.scrollView = this.scroll.reset('Returning to pointer'); this.scrollEngaged = false
        this.uprightSince = null
        this.click.cancel('Confirm open hand after scrolling')
        return this.publish(this.click.update(frame, receivedAt))
      }
      return this.scrollFrame(frame, receivedAt, pose === 'ENTER')
    }
    if ((hand.pose === 'OPEN' || hand.pose === 'UNKNOWN') && (pose === 'ENTER' || pose === 'RETAIN')) {
      this.click.cancel('Scroll rotation clears pointer target'); this.scrollEngaged = true
      return hand.pose === 'OPEN' ? this.scrollFrame(frame, receivedAt, pose === 'ENTER') : this.cancel('Uncertain rotating hand')
    }
    return this.publish(this.click.update(frame, receivedAt))
  }

  tick(now: number, targets?: InteractionTarget[]): PageGestureSnapshot {
    this.now = now
    // Release lockout outlives cancellation, but display ticks cannot turn that
    // bookkeeping into new interaction feedback without a fresh observation.
    if (this.snapshot.interactionState === 'INACTIVE') return this.snapshot
    if (this.frame && (!Number.isFinite(now) || now < this.frame.timestampMs || now - this.frame.timestampMs > this.config.freshnessMs)) return this.cancel('Tracking expired; all effects stopped')
    if (this.scrollEngaged) {
      if (this.scrollView.state !== 'INACTIVE') this.scrollView = this.scroll.tick(now)
      return this.publishScroll()
    }
    return this.publish(this.click.tick(now, targets))
  }

  private scrollFrame(frame: InteractionFrame, receivedAt: number, mayEnter: boolean) {
    this.scrollView = this.scroll.observe(frame.hands[0], mayEnter, true, receivedAt)
    return this.publishScroll()
  }
  private publishScroll() {
    const s = this.scrollView
    return this.publish({ ...this.snapshot, activation: null, pointer: null, clickId: null, focusId: null, proximity: {}, drag: null,
      scrollVelocity: s.velocity, targetLocked: false, confirmationProgress: 0, clickState: 'OPEN',
      mode: s.state === 'ACTIVE' ? 'SCROLL' : 'UNCERTAIN', reason: s.reason },
    s.state === 'ACTIVE' ? 'SCROLL_ACTIVE' : s.state === 'ENTRY' ? 'SCROLL_ENTRY' : 'UNCERTAIN', s.deltaY)
  }
  private publish(base: ClickSnapshot, state?: PageInteractionState, delta = 0): PageGestureSnapshot {
    const next = state ?? (base.clickState === 'FIST_TRANSITION' || base.clickState === 'FIST_CONFIRMED' ? 'CLICK_CONFIRMATION'
      : base.mode === 'POINTER' ? 'POINTER_MODE' : base.mode === 'IDLE' ? 'INACTIVE' : 'UNCERTAIN')
    if (next !== this.snapshot.interactionState) {
      this.transitionCount++; this.transitions.push({ state: next, reason: base.reason, time: this.now })
      if (this.transitions.length > 50) this.transitions.shift()
    }
    return this.snapshot = { ...base, interactionState: next, scrollDeltaY: delta }
  }
}
