import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import CameraManager from './components/CameraManager'
import GesturePlayground from './components/GesturePlayground'
import PointerDebug from './components/PointerDebug'
import ScrollDebug from './components/ScrollDebug'
import { PointerMeasurementSession, FeedbackLatency, type PointerMeasurement } from './evaluation/PointerMeasurement'
import { PageGestureEngine } from './control/PageGestureEngine'
import { PageScrollTarget, interruptsPageInput } from './control/PageScrollTarget'
import { InteractionTargetRegistry } from './control/InteractionTargetRegistry'
import { APP_CLICK_TARGET_IDS, CLICK_TARGET_IDS, collectTargets, eligibleElement } from './control/TargetElements'
import { HandTracker } from './control/HandTracker'
import { TOUCHPAD_GESTURE_CONFIG, TOUCHPAD_MOVEMENT_RANGE, type GestureConfig } from './control/GestureConfig'
import { calibratePointer, constrainCardPosition } from './control/MovementCalibration'
import type { Point2, TrackedHand, TrackingFrame } from './control/types'
import type { PerformanceReport } from './tracking/TrackingPerformance'
import type { BenchmarkReport } from './tracking/protocol'
import type {SpatialControlBridge} from './spatial/SpatialControlBridge'

export default function App({spatial,spatialContent}:{spatial?:SpatialControlBridge;spatialContent?:ReactNode}={}) {
  const arenaRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLDivElement>(null)
  const [cardPosition, setCardPosition] = useState<Point2>({ x: 0, y: 0 })
  const [activations, setActivations] = useState(0)
  const [buttonActivations, setButtonActivations] = useState<Record<string, number>>({})
  const [palette, setPalette] = useState<'violet' | 'mint' | 'amber'>('violet')
  const [paused, setPaused] = useState(false), pausedRef = useRef(false)
  const [debugEnabled, setDebugEnabled] = useState(false), debugRef = useRef(false)
  const [automaticScroll, setAutomaticScroll] = useState(true)
  const [config, setConfig] = useState<GestureConfig>({ ...TOUCHPAD_GESTURE_CONFIG })
  const [calibrationMessage, setCalibrationMessage] = useState('Move your open hand like a touchpad. Lower it to reposition; raise it to continue from the same place. Capture comfortable center returns the selection to screen center.')
  const [range, setRange] = useState(TOUCHPAD_MOVEMENT_RANGE)
  const [engine] = useState(() => new PageGestureEngine(TOUCHPAD_GESTURE_CONFIG))
  const [registry] = useState(() => new InteractionTargetRegistry())
  const [tracker] = useState(() => new HandTracker())
  const [snapshot, setSnapshot] = useState(() => engine.cancel('Start camera to begin.'))
  const latestRef = useRef(snapshot), lastHandRef = useRef<TrackedHand | null>(null)
  const lastUiPublishRef = useRef(0)
  const [feedbackLatency] = useState(() => new FeedbackLatency())
  const [scrollFeedback] = useState(() => new FeedbackLatency())
  const lastCaptureRef = useRef<number | null>(null)
  const [pageScroll] = useState(() => new PageScrollTarget({
    read: () => { const page = document.scrollingElement; return { top: page?.scrollTop ?? 0, max: Math.max(0, (page?.scrollHeight ?? 0) - window.innerHeight) } },
    write: top => window.scrollTo({ top, behavior: 'instant' }),
  }))
  const [debugView, setDebugView] = useState(() => ({ diagnostics: { ...engine.diagnostics }, click: { ...engine.clickDiagnostics }, scroll: engine.scrollDiagnostics,
    snapshot, measurement: new PointerMeasurementSession().data, feedback: feedbackLatency.report(), scrollFeedback: scrollFeedback.report() }))
  const [perf, setPerf] = useState<PerformanceReport | null>(null)
  const [backend, setBackend] = useState('Not initialized')
  const [benchmark, setBenchmark] = useState<BenchmarkReport | null>(null)
  const [measurement, setMeasurement] = useState<PointerMeasurement['mode']>('off')
  const measurementRef = useRef(new PointerMeasurementSession())

  // Native controls and the five registered gesture actions share application handlers.
  const activateDemo = useCallback((id: string) => {
    if (id === 'reset') { setActivations(0); setButtonActivations({}); setCardPosition({ x: 0, y: 0 }); setPalette('violet') }
    else if (id === 'palette') {
      setPalette(previous => previous === 'violet' ? 'mint' : previous === 'mint' ? 'amber' : 'violet')
      setActivations(count => count + 1)
    } else {
      setActivations(count => count + 1)
      if (CLICK_TARGET_IDS.some(registered => registered === id)) setButtonActivations(previous => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }))
    }
  }, [])
  useEffect(() => {
    const registrations = APP_CLICK_TARGET_IDS.flatMap(id => {
      const element = document.querySelector<HTMLButtonElement>(`button[data-gesture-target="${id}"]`)
      if (!element) return []
      return [registry.register(id, element,
        () => eligibleElement(element) && document.querySelector(`button[data-gesture-target="${id}"]`) === element,
        () => activateDemo(id))]
    })
    return () => { for (const entry of registrations) entry.unregister() }
  }, [registry, activateDemo])
  const moveCard = useCallback((delta: Point2) => {
    const arena = arenaRef.current, card = arena?.querySelector<HTMLElement>('[data-gesture-target="orbit-card"]')
    if (!arena || !card) return
    const bounds = arena.getBoundingClientRect(), cardBounds = card.getBoundingClientRect()
    setCardPosition(previous => constrainCardPosition(previous, delta, bounds, cardBounds))
  }, [])
  const cancel = useCallback(() => {
    const handoff=spatial?.cancel()
    tracker.reset(); lastHandRef.current = null
    latestRef.current = handoff?engine.retainPointerGeometry(handoff.point,handoff.viewport):engine.cancel('Tracking stopped; raise an open hand')
    feedbackLatency.cancel(); scrollFeedback.cancel(); pageScroll.clear(); lastCaptureRef.current = null
    measurementRef.current.observe(latestRef.current, false, performance.now())
    setSnapshot(latestRef.current)
  }, [engine, tracker, feedbackLatency, scrollFeedback, pageScroll, spatial])

  const handleFrame = useCallback((frame: TrackingFrame) => {
    if (document.hidden || !document.hasFocus() || pausedRef.current || frame.evaluationOnly) { cancel(); return }
    const targets = collectTargets(registry)
    const tracking = tracker.update(frame)
    lastCaptureRef.current = frame.timestampMs
    lastHandRef.current = tracking.hands.length === 1 && !tracking.ambiguous ? tracking.hands[0] : null
    const interactionFrame={ ...tracking, timestampMs: frame.timestampMs, targets,viewport: { width: window.innerWidth, height: window.innerHeight } }
    const now=performance.now(),route=spatial?.beforeFrame(frame,interactionFrame,now)
    if(route?.handoff)latestRef.current=engine.retainPointerGeometry(route.handoff.point,route.handoff.viewport)
    if(route?.consumed){
      if(!route.handoff)latestRef.current=engine.cancel('Spatial manipulation owns input')
      feedbackLatency.cancel();scrollFeedback.cancel();pageScroll.stop()
      measurementRef.current.observe(latestRef.current,false,now,true)
      return
    }
    latestRef.current = engine.update(interactionFrame,now)
    if(!route?.processed)spatial?.afterFrame(frame,interactionFrame,latestRef.current,engine.diagnostics.confirmed,performance.now())
    const request = latestRef.current.activation
    if (request) {
      const freshAndActive = !document.hidden && document.hasFocus() && !pausedRef.current && performance.now() - frame.timestampMs <= config.freshnessMs
      const accepted = freshAndActive && registry.activate(request)
      engine.acknowledge(request.sequence, accepted, performance.now())
    }
    measurementRef.current.observe(latestRef.current, engine.diagnostics.confirmed, performance.now(), true)
    if (latestRef.current.pointer) feedbackLatency.submitted(frame.timestampMs)
    else feedbackLatency.cancel()
    if (latestRef.current.scrollVelocity !== 0) scrollFeedback.submitted(frame.timestampMs)
    else scrollFeedback.cancel()
  }, [engine, tracker, registry, cancel, feedbackLatency, scrollFeedback, config.freshnessMs, spatial, pageScroll])

  useEffect(() => {
    let animation = 0
    function tick() {
      // Use current time: the RAF timestamp can predate a synchronous fallback
      // inference completed earlier in the same animation callback batch.
      const now = performance.now()
      const handoff=spatial?.tick(now)
      if(handoff)latestRef.current=engine.retainPointerGeometry(handoff.point,handoff.viewport)
      const next = engine.tick(now, engine.clickDiagnostics.targetLocked ? collectTargets(registry, engine.clickDiagnostics.lockedTargetId!) : undefined); latestRef.current = next
      if (next.scrollDeltaY !== 0 && lastCaptureRef.current !== null && !document.hidden && document.hasFocus() && !pausedRef.current) {
        const applied = pageScroll.apply(next.scrollDeltaY, performance.now(), lastCaptureRef.current)
        if (applied !== 0) scrollFeedback.rendered(performance.now())
      } else if (next.scrollVelocity === 0) { scrollFeedback.cancel(); pageScroll.stop() }
      measurementRef.current.observe(next, engine.diagnostics.confirmed, now)
      // Target feedback follows display cadence; the whole page does not rerender.
      for (const element of document.querySelectorAll<HTMLElement>('[data-gesture-target]')) {
        const id = element.dataset.gestureTarget!
        element.style.setProperty('--proximity', String(next.proximity[id] ?? 0))
        element.classList.toggle('is-focused', next.focusId === id)
        element.classList.toggle('is-ready', next.clickState === 'TARGET_FOCUSED' && next.focusId === id)
        element.classList.toggle('is-confirming', next.targetLocked && next.clickState === 'FIST_TRANSITION' && next.focusId === id)
        element.style.setProperty('--fist-progress', String(next.confirmationProgress))
      }
      const dot = document.getElementById('debug-interaction-point')
      if (dot) { dot.style.display = next.pointer ? 'block' : 'none'; if (next.pointer) dot.style.transform = `translate(${next.pointer.x}px, ${next.pointer.y}px)` }
      if (next.pointer) feedbackLatency.rendered(performance.now())
      else feedbackLatency.cancel()
      if (now - lastUiPublishRef.current >= 100) {
        lastUiPublishRef.current = now
        setSnapshot(previous => previous.mode === next.mode && previous.focusId === next.focusId && previous.reason === next.reason && previous.clickState === next.clickState && previous.interactionState === next.interactionState ? previous : next)
        if (debugRef.current) setDebugView({ diagnostics: { ...engine.diagnostics }, click: { ...engine.clickDiagnostics }, scroll: engine.scrollDiagnostics, snapshot: next,
          measurement: { ...measurementRef.current.data, points: [...measurementRef.current.data.points] }, feedback: feedbackLatency.report(), scrollFeedback: scrollFeedback.report() })
      }
      animation = requestAnimationFrame(tick)
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { pausedRef.current = true; setPaused(true); cancel() }
      else if (interruptsPageInput('keydown', event.key, isControl(event.target))) cancel()
    }
    function isControl(target: EventTarget | null) { return target instanceof Element && !!target.closest('button,input,select,textarea,[contenteditable="true"]') }
    function touched(event: TouchEvent) { if (interruptsPageInput('touchstart', '', isControl(event.target))) cancel() }
    function scrolled(event: Event) {
      if ((event.target === document || event.target === document.scrollingElement) && pageScroll.isOwnScroll(window.scrollY, performance.now())) return
      cancel()
    }
    function visibility() { if (document.hidden) cancel() }
    animation = requestAnimationFrame(tick)
    document.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('scroll', scrolled, true)
    window.addEventListener('wheel', cancel, { passive: true }); window.addEventListener('touchstart', touched, { passive: true })
    return () => {
      cancelAnimationFrame(animation); document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('wheel', cancel); window.removeEventListener('touchstart', touched); pageScroll.clear(); engine.cancel()
    }
  }, [engine, registry, cancel, feedbackLatency, scrollFeedback, pageScroll, spatial])

  function applyConfig(next: GestureConfig) { spatial?.configure(next); setConfig(next); latestRef.current = engine.configure(next); setSnapshot(latestRef.current) }
  function centerPointer() {
    const hand = lastHandRef.current
    if (!hand || hand.pose !== 'OPEN' || performance.now() - hand.timestampMs > config.freshnessMs) {
      setCalibrationMessage('Calibration needs one fresh open palm. Keep it visible and try again.'); return
    }
    if (config.pointerMode === 'relative') {
      latestRef.current = engine.recenterPointer(); setSnapshot(latestRef.current)
    } else applyConfig(calibratePointer(hand.center, config))
    setCalibrationMessage('Comfortable center captured. Hold the open palm to confirm.')
  }

  return <GesturePlayground
    spatialContent={spatialContent}
    scrollTestPage={window.location.pathname === '/scroll-test'}
    cameraControls={<>
      <CameraManager pointerStatus={`${debugView.click.pose} · ${debugView.snapshot.interactionState} · ID ${debugView.diagnostics.handId ?? '—'} · ${debugView.snapshot.focusId ?? 'no target'}`} onPerformance={(report, usedBackend, comparison) => { spatial?.setPerformance(report,usedBackend); setPerf(report); setBackend(usedBackend); setBenchmark(comparison) }} onFrame={handleFrame} onInactive={cancel}
        onDebugChange={enabled => { cancel(); spatial?.setDebug(enabled); engine.setDebugTrace(enabled); debugRef.current = enabled; setDebugEnabled(enabled); if (!enabled) { latestRef.current = engine.setAutomaticScroll(true); setAutomaticScroll(true) } }} />
      <button className="pause-gestures" onClick={() => { pausedRef.current = !paused; setPaused(!paused); cancel() }}>{paused ? 'Resume pointer' : 'Pause pointer'}</button>
    </>}
    snapshot={snapshot} cardPosition={cardPosition} activations={activations} buttonActivations={buttonActivations} palette={palette}
    onActivate={id => { cancel(); activateDemo(id) }} onManualDrag={delta => { cancel(); moveCard(delta) }} arenaRef={arenaRef} scrollRef={scrollRef}
  >
    {debugEnabled && <>
      <section className="movement-settings" aria-label="Navigation comparison">
        <label><input type="checkbox" aria-label="Automatic page scrolling" checked={automaticScroll} onChange={event => {
          const enabled = event.target.checked; setAutomaticScroll(enabled)
          latestRef.current = engine.setAutomaticScroll(enabled); setSnapshot(latestRef.current); pageScroll.clear()
        }} /> Automatic page scrolling</label>
        <p>Turn off for a navigation-only comparison. Changing this setting clears prepared clicks and scroll intent. Leaving debug restores automatic scrolling.</p>
      </section>
      <ScrollDebug diagnostics={debugView.scroll} feedback={debugView.scrollFeedback}
        onConfigure={next => { latestRef.current = engine.configureScroll(next); setSnapshot(latestRef.current); pageScroll.clear() }}
        onCapture={() => { engine.calibrateScrollPose(performance.now()); latestRef.current = engine.tick(performance.now()); setSnapshot(latestRef.current) }}
        onReset={() => { latestRef.current = engine.resetNeutral(); setSnapshot(latestRef.current); pageScroll.clear() }}
        onDefaults={() => { latestRef.current = engine.restoreScrollDefaults(); setSnapshot(latestRef.current); pageScroll.clear() }} />
      <PointerDebug diagnostics={debugView.diagnostics} click={debugView.click} snapshot={debugView.snapshot} perf={perf} backend={backend} benchmark={benchmark} measurement={debugView.measurement} feedback={debugView.feedback} />
      <section className="movement-settings" aria-label="Pointer calibration">
        <h2>Comfortable movement</h2><p>{calibrationMessage}</p>
        <button onClick={centerPointer}>Capture comfortable center</button>{' '}<button onClick={() => { applyConfig({ ...TOUCHPAD_GESTURE_CONFIG }); latestRef.current = engine.recenterPointer(); setSnapshot(latestRef.current); setRange(TOUCHPAD_MOVEMENT_RANGE) }}>Restore defaults</button>
        <label>Pointer movement mode <select aria-label="Pointer movement mode" value={config.pointerMode ?? 'absolute'} onChange={event => applyConfig({ ...config, pointerMode: event.target.value as 'relative' | 'absolute' })}>
          <option value="relative">Touchpad · relative movement</option><option value="absolute">Camera position · absolute comparison</option>
        </select></label>
        <label>Movement filter <select aria-label="Movement filter" value={config.pointerFilter ?? 'fixed'} onChange={event => applyConfig({ ...config, pointerFilter: event.target.value as 'fixed'|'adaptive' })}>
          <option value="adaptive">Adaptive · fast motion / steady focus (candidate)</option><option value="fixed">Fixed smoothing · baseline</option>
        </select></label>
        <label>Pointer movement gain <input aria-label="Pointer movement gain" type="range" min="0.8" max="2.5" step="0.1" value={config.pointerGain}
          onChange={event => applyConfig({ ...config, pointerGain: Number(event.target.value) })} /> {config.pointerGain.toFixed(1)}×</label>
        <label>Pointer smoothing <input aria-label="Pointer smoothing" type="range" min="35" max="200" step="5" value={config.pointerSmoothingMs}
          onChange={event => applyConfig({ ...config, pointerSmoothingMs: Number(event.target.value) })} /> {config.pointerSmoothingMs} ms</label>
        <p>Adaptive filtering follows fast movement with less delay and filters small movements without a dead zone. This value controls its resting time constant. Fixed mode retains the historical smoothing and dead zone. Compare movement and stationary stability separately.</p>
        <label>Camera movement range <input type="range" min="0.30" max="0.90" step="0.05" value={range} onChange={event => {
          const size = Number(event.target.value); setRange(size)
          const cx = (config.pointerMinX + config.pointerMaxX) / 2, cy = (config.pointerMinY + config.pointerMaxY) / 2
          const halfX = size / 2, halfY = size / 2
          applyConfig({ ...config, pointerMinX: cx - halfX, pointerMaxX: cx + halfX, pointerMinY: cy - halfY, pointerMaxY: cy + halfY })
        }} /> {(range * 100).toFixed(0)}% (larger = lower movement gain)</label>
        <label>Acceptance measurement <select aria-label="Acceptance measurement" value={measurement} onChange={event => {
          const mode = event.target.value as typeof measurement; setMeasurement(mode); measurementRef.current = new PointerMeasurementSession(mode)
        }}><option value="off">Off / reset</option><option value="stationary">Stationary palm · 10 seconds</option><option value="moving">Moving between five targets</option></select></label>
        <p>Open palm to aim; hold a complete fist to activate one of the five test buttons once. A confirmed flat palm scrolls the page. Reopen upright to resume aiming. Drag and two-hand controls remain disabled. Escape pauses gestures.</p>
      </section>
    </>}
  </GesturePlayground>
}
