import { useCallback, useEffect, useRef, useState } from 'react'
import CameraManager from './components/CameraManager'
import GesturePlayground from './components/GesturePlayground'
import PointerDebug from './components/PointerDebug'
import { PointerMeasurementSession, FeedbackLatency, type PointerMeasurement } from './evaluation/PointerMeasurement'
import { OpenPointerEngine } from './control/OpenPointerEngine'
import { HandTracker } from './control/HandTracker'
import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './control/GestureConfig'
import { calibratePointer, constrainCardPosition } from './control/MovementCalibration'
import type { InteractionSnapshot, InteractionTarget, Point2, TrackedHand, TrackingFrame } from './control/types'
import type { PerformanceReport } from './tracking/TrackingPerformance'
import type { BenchmarkReport } from './tracking/protocol'

export default function App() {
  const arenaRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLDivElement>(null)
  const [cardPosition, setCardPosition] = useState<Point2>({ x: 0, y: 0 })
  const [activations, setActivations] = useState(0)
  const [palette, setPalette] = useState<'violet' | 'mint' | 'amber'>('violet')
  const [paused, setPaused] = useState(false), pausedRef = useRef(false)
  const [debugEnabled, setDebugEnabled] = useState(false), debugRef = useRef(false)
  const [config, setConfig] = useState<GestureConfig>({ ...DEFAULT_GESTURE_CONFIG })
  const [calibrationMessage, setCalibrationMessage] = useState('Hold one upright open palm at a comfortable center, then capture it.')
  const [range, setRange] = useState(.70)
  const [engine] = useState(() => new OpenPointerEngine())
  const [tracker] = useState(() => new HandTracker())
  const [snapshot, setSnapshot] = useState<InteractionSnapshot>(() => engine.cancel('Start camera to begin.'))
  const latestRef = useRef(snapshot), lastHandRef = useRef<TrackedHand | null>(null)
  const lastUiPublishRef = useRef(0)
  const [feedbackLatency] = useState(() => new FeedbackLatency())
  const [debugView, setDebugView] = useState(() => ({ diagnostics: { ...engine.diagnostics }, snapshot, measurement: new PointerMeasurementSession().data, feedback: feedbackLatency.report() }))
  const [perf, setPerf] = useState<PerformanceReport | null>(null)
  const [backend, setBackend] = useState('Not initialized')
  const [benchmark, setBenchmark] = useState<BenchmarkReport | null>(null)
  const [measurement, setMeasurement] = useState<PointerMeasurement['mode']>('off')
  const measurementRef = useRef(new PointerMeasurementSession())

  // These handlers belong exclusively to native mouse/touch/keyboard input.
  const activateDemo = useCallback((id: string) => {
    if (id === 'reset') { setActivations(0); setCardPosition({ x: 0, y: 0 }); setPalette('violet') }
    else if (id === 'palette') {
      setPalette(previous => previous === 'violet' ? 'mint' : previous === 'mint' ? 'amber' : 'violet')
      setActivations(count => count + 1)
    } else setActivations(count => count + 1)
  }, [])
  const moveCard = useCallback((delta: Point2) => {
    const arena = arenaRef.current, card = arena?.querySelector<HTMLElement>('[data-gesture-target="orbit-card"]')
    if (!arena || !card) return
    const bounds = arena.getBoundingClientRect(), cardBounds = card.getBoundingClientRect()
    setCardPosition(previous => constrainCardPosition(previous, delta, bounds, cardBounds))
  }, [])
  const cancel = useCallback(() => {
    tracker.reset(); lastHandRef.current = null
    latestRef.current = engine.cancel('Tracking stopped; raise an upright open hand')
    feedbackLatency.cancel()
    measurementRef.current.observe(latestRef.current, false, performance.now())
    setSnapshot(latestRef.current)
  }, [engine, tracker, feedbackLatency])

  const handleFrame = useCallback((frame: TrackingFrame) => {
    if (document.hidden || !document.hasFocus() || pausedRef.current || frame.evaluationOnly) { cancel(); return }
    const targets: InteractionTarget[] = Array.from(document.querySelectorAll<HTMLElement>('[data-gesture-target]')).flatMap(element => {
      if (!element.getClientRects().length) return []
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return []
      return [{ id: element.dataset.gestureTarget!, kind: 'click' as const,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, disabled: element.matches(':disabled, [aria-disabled="true"]') }]
    })
    const tracking = tracker.update(frame)
    lastHandRef.current = tracking.hands.length === 1 && !tracking.ambiguous ? tracking.hands[0] : null
    latestRef.current = engine.update({ ...tracking, timestampMs: frame.timestampMs, targets,
      viewport: { width: window.innerWidth, height: window.innerHeight } }, performance.now())
    measurementRef.current.observe(latestRef.current, engine.diagnostics.confirmed, performance.now(), true)
    if (latestRef.current.pointer) feedbackLatency.submitted(frame.timestampMs)
    else feedbackLatency.cancel()
  }, [engine, tracker, cancel, feedbackLatency])

  useEffect(() => {
    let animation = 0
    function tick(now: number) {
      const next = engine.tick(now); latestRef.current = next
      measurementRef.current.observe(next, engine.diagnostics.confirmed, now)
      // Target feedback follows display cadence; the whole page does not rerender.
      for (const element of document.querySelectorAll<HTMLElement>('[data-gesture-target]')) {
        const id = element.dataset.gestureTarget!
        element.style.setProperty('--proximity', String(next.proximity[id] ?? 0))
        element.classList.toggle('is-focused', next.focusId === id)
      }
      const dot = document.getElementById('debug-interaction-point')
      if (dot) { dot.style.display = next.pointer ? 'block' : 'none'; if (next.pointer) dot.style.transform = `translate(${next.pointer.x}px, ${next.pointer.y}px)` }
      if (next.pointer) feedbackLatency.rendered(performance.now())
      else feedbackLatency.cancel()
      if (now - lastUiPublishRef.current >= 100) {
        lastUiPublishRef.current = now
        setSnapshot(previous => previous.mode === next.mode && previous.focusId === next.focusId && previous.reason === next.reason ? previous : next)
        if (debugRef.current) setDebugView({ diagnostics: { ...engine.diagnostics }, snapshot: next, measurement: { ...measurementRef.current.data, points: [...measurementRef.current.data.points] }, feedback: feedbackLatency.report() })
      }
      animation = requestAnimationFrame(tick)
    }
    function key(event: KeyboardEvent) { if (event.key === 'Escape') { pausedRef.current = true; setPaused(true); cancel() } }
    function visibility() { if (document.hidden) cancel() }
    animation = requestAnimationFrame(tick)
    document.addEventListener('keydown', key); document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel); window.addEventListener('scroll', cancel, true)
    return () => {
      cancelAnimationFrame(animation); document.removeEventListener('keydown', key); document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel); window.removeEventListener('scroll', cancel, true); engine.cancel()
    }
  }, [engine, cancel, feedbackLatency])

  function applyConfig(next: GestureConfig) { setConfig(next); latestRef.current = engine.configure(next); setSnapshot(latestRef.current) }
  function centerPointer() {
    const hand = lastHandRef.current
    if (!hand || hand.pose !== 'OPEN' || hand.orientation !== 'UPRIGHT_LIKE' || performance.now() - hand.timestampMs > config.freshnessMs) {
      setCalibrationMessage('Calibration needs one fresh upright open palm. Keep it visible and try again.'); return
    }
    applyConfig(calibratePointer(hand.center, config))
    setCalibrationMessage('Comfortable center captured. Hold the open palm to confirm.')
  }

  return <GesturePlayground
    cameraControls={<>
      <CameraManager pointerStatus={`${debugView.diagnostics.raw} · ${debugView.diagnostics.confirmed ? 'confirmed' : 'waiting'} · ID ${debugView.diagnostics.handId ?? '—'} · ${debugView.snapshot.focusId ?? 'no target'}`} onPerformance={(report, usedBackend, comparison) => { setPerf(report); setBackend(usedBackend); setBenchmark(comparison) }} onFrame={handleFrame} onInactive={cancel}
        onDebugChange={enabled => { cancel(); debugRef.current = enabled; setDebugEnabled(enabled) }} />
      <button className="pause-gestures" onClick={() => { pausedRef.current = !paused; setPaused(!paused); cancel() }}>{paused ? 'Resume pointer' : 'Pause pointer'}</button>
    </>}
    snapshot={snapshot} cardPosition={cardPosition} activations={activations} palette={palette}
    onActivate={id => { cancel(); activateDemo(id) }} onManualDrag={delta => { cancel(); moveCard(delta) }} arenaRef={arenaRef} scrollRef={scrollRef}
  >
    {debugEnabled && <>
      <PointerDebug diagnostics={debugView.diagnostics} snapshot={debugView.snapshot} perf={perf} backend={backend} benchmark={benchmark} measurement={debugView.measurement} feedback={debugView.feedback} />
      <section className="movement-settings" aria-label="Pointer calibration">
        <h2>Comfortable movement</h2><p>{calibrationMessage}</p>
        <button onClick={centerPointer}>Capture comfortable center</button>{' '}<button onClick={() => { applyConfig({ ...DEFAULT_GESTURE_CONFIG }); setRange(.70) }}>Restore defaults</button>
        <label>Camera movement range <input type="range" min="0.30" max="0.90" step="0.05" value={range} onChange={event => {
          const size = Number(event.target.value); setRange(size)
          const cx = (config.pointerMinX + config.pointerMaxX) / 2, cy = (config.pointerMinY + config.pointerMaxY) / 2
          const halfX = Math.min(size / 2, cx, 1 - cx), halfY = Math.min(size / 2, cy, 1 - cy)
          applyConfig({ ...config, pointerMinX: cx - halfX, pointerMaxX: cx + halfX, pointerMinY: cy - halfY, pointerMaxY: cy + halfY })
        }} /> {(range * 100).toFixed(0)}% (larger = lower movement gain)</label>
        <label>Acceptance measurement <select aria-label="Acceptance measurement" value={measurement} onChange={event => {
          const mode = event.target.value as typeof measurement; setMeasurement(mode); measurementRef.current = new PointerMeasurementSession(mode)
        }}><option value="off">Off / reset</option><option value="stationary">Stationary palm · 10 seconds</option><option value="moving">Moving between five targets</option></select></label>
        <p>Highlight only. Fist, drag, scrolling and two-hand controls are disabled. Escape pauses pointer feedback.</p>
      </section>
    </>}
  </GesturePlayground>
}
