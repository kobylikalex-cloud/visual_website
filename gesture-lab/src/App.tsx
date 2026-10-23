
import { useCallback, useEffect, useRef, useState } from 'react'
import CameraManager from './components/CameraManager'
import GesturePlayground from './components/GesturePlayground'
import { PlaygroundController } from './control/PlaygroundController'
import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './control/GestureConfig'
import { calibratePointer, constrainCardPosition } from './control/MovementCalibration'
import {
  buildGestureProfile, readCalibrationSample,
  type CalibrationLabel, type CalibrationSample, type CalibrationRecordings,
} from './control/GestureProfile'
import type { InteractionSnapshot, InteractionTarget, Point2, TrackingFrame } from './control/types'

export default function App() {
  const arenaRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [cardPosition, setCardPosition] = useState<Point2>({ x: 0, y: 0 })
  const [activations, setActivations] = useState(0)
  const [palette, setPalette] = useState<'violet' | 'mint' | 'amber'>('violet')
  const [paused, setPaused] = useState(false)
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [config, setConfig] = useState<GestureConfig>({ ...DEFAULT_GESTURE_CONFIG })
  const [calibrationMessage, setCalibrationMessage] = useState('Point with one upright open hand, then center your comfortable reach.')
  const [gestureCalibrationMessage, setGestureCalibrationMessage] = useState('Record your own upright palm, closed fist and flat palm to rebaseline recognition.')
  const capturesRef = useRef<CalibrationRecordings>({ OPEN_UPRIGHT: [], FIST: [], OPEN_FLAT: [] })
  const activeCaptureRef = useRef<{ label: CalibrationLabel; starts: number; ends: number; samples: CalibrationSample[] } | null>(null)
  const [captureLabel, setCaptureLabel] = useState<CalibrationLabel | null>(null)
  const [calibrated, setCalibrated] = useState(false)
  const [capturedCounts, setCapturedCounts] = useState<Record<CalibrationLabel, number>>({
    OPEN_UPRIGHT: 0, FIST: 0, OPEN_FLAT: 0,
  })

  const activateDemo = useCallback((id: string) => {
    if (id === 'reset') {
      setActivations(0); setCardPosition({ x: 0, y: 0 }); setPalette('violet')
    } else if (id === 'pulse') setActivations(count => count + 1)
    else if (id === 'palette') {
      setPalette(previous => previous === 'violet' ? 'mint' : previous === 'mint' ? 'amber' : 'violet')
      setActivations(count => count + 1)
    }
  }, [])

  const moveCard = useCallback((delta: Point2) => {
    const arena = arenaRef.current
    const card = arena?.querySelector<HTMLElement>('[data-gesture-target="orbit-card"]')
    if (!arena || !card) return
    const bounds = arena.getBoundingClientRect()
    const cardBounds = card.getBoundingClientRect()
    setCardPosition(previous => constrainCardPosition(previous, delta, bounds, cardBounds))
  }, [])

  const [controller] = useState(() => new PlaygroundController())
  const [snapshot, setSnapshot] = useState<InteractionSnapshot>(() => controller.cancel())
  const lastUiPublishRef = useRef(0)
  const lastUiSnapshotRef = useRef<InteractionSnapshot | null>(null)
  const lastDiagnosticsRef = useRef(0)
  const [liveGestureDiagnostics, setLiveGestureDiagnostics] = useState('No tracking sample')

  useEffect(() => {
    controller.setEffects({ activate: activateDemo, dragBy: moveCard,
      // Gesture scrolling navigates the webpage, not only the small journal.
      // The journal itself remains independently mouse/keyboard-scrollable.
      scrollBy: deltaY => window.scrollBy({ top: deltaY, behavior: 'instant' }) })
  }, [controller, activateDemo, moveCard])

  const cancel = useCallback(() => setSnapshot(controller.cancel()), [controller])
  const handleFrame = useCallback((frame: TrackingFrame) => {
    if (document.hidden || !document.hasFocus()) { cancel(); return }
    const capturing = activeCaptureRef.current
    if (capturing) {
      const now = performance.now()
      if (now >= capturing.starts && now <= capturing.ends && frame.detections.length === 1) {
        const sample = readCalibrationSample(frame.detections[0].worldLandmarks)
        if (sample) capturing.samples.push(sample)
      }
      if (now >= capturing.ends) {
        activeCaptureRef.current = null
        setCaptureLabel(null)
        capturesRef.current[capturing.label] = capturing.samples
        setCapturedCounts(previous => ({ ...previous, [capturing.label]: capturing.samples.length }))
        const count = capturing.samples.length
        if (count < 6) {
          setGestureCalibrationMessage('Too few clean samples (' + count + '). Keep one whole hand visible and repeat this gesture.')
        } else {
          setGestureCalibrationMessage(capturing.label + ': ' + count + ' samples captured.')
          const profile = buildGestureProfile(capturesRef.current)
          if (profile) {
            setSnapshot(controller.setProfile(profile))
            setCalibrated(true)
            setGestureCalibrationMessage('CALIBRATED: your three personal gestures are now active. Test pointing, grasping and scroll.')
          } else if (Object.values(capturesRef.current).every(samples => samples.length >= 6)) {
            setCalibrated(false)
            setGestureCalibrationMessage('Calibration poses overlap or are unstable. Record three distinctly different positions again.')
          }
        }
        setSnapshot(controller.setEnabled(!paused))
      }
    }
    const targets: InteractionTarget[] = Array.from(document.querySelectorAll<HTMLElement>('[data-gesture-target]')).flatMap(element => {
      if (!element.getClientRects().length) return []
      const rect = element.getBoundingClientRect()
      if (!['pulse', 'palette', 'reset', 'orbit-card'].includes(element.dataset.gestureTarget ?? '') ||
        rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return []
      return [{ id: element.dataset.gestureTarget!, kind: element.dataset.gestureKind === 'drag' ? 'drag' as const : 'click' as const,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        disabled: element.matches(':disabled, [aria-disabled="true"]') }]
    })
    const current = performance.now()
    const next = controller.update(frame, targets, { width: window.innerWidth, height: window.innerHeight }, current)
    const prior = lastUiSnapshotRef.current
    // MediaPipe runs at most ~20 Hz. Avoid re-rendering the entire page for
    // every minor landmark movement; CSS interpolates proximity between UI updates.
    const stateChanged = !prior || prior.mode !== next.mode ||
      prior.focusId !== next.focusId || prior.reason !== next.reason
    if (stateChanged || current - lastUiPublishRef.current >= 100) {
      lastUiPublishRef.current = current
      lastUiSnapshotRef.current = next
      setSnapshot(next)
    }
    if (debugEnabled && current - lastDiagnosticsRef.current >= 200) {
      lastDiagnosticsRef.current = current
      const tracking = controller.getTracking()
      const hands = tracking.hands.map(hand =>
        `#${hand.id}: ${hand.pose} / ${hand.orientation} · palm ${(hand.center.x * 100).toFixed(0)}%, ${(hand.center.y * 100).toFixed(0)}%`)
      setLiveGestureDiagnostics(hands.join(' | ') || tracking.reason)
    }
  }, [controller, cancel, paused, debugEnabled])

  useEffect(() => {
    let animation = 0
    function tick(now: number) {
      const next = controller.tick(now)
      setSnapshot(previous => previous.mode === next.mode && previous.focusId === next.focusId && previous.reason === next.reason ? previous : next)
      animation = requestAnimationFrame(tick)
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPaused(true)
        setSnapshot(controller.setEnabled(false))
      }
    }
    function visibility() { if (document.hidden) cancel() }
    animation = requestAnimationFrame(tick)
    document.addEventListener('keydown', key)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', cancel)
    window.addEventListener('resize', cancel)
    return () => {
      cancelAnimationFrame(animation)
      document.removeEventListener('keydown', key)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('resize', cancel)
      controller.cancel()
    }
  }, [controller, cancel])

  function applyConfig(next: GestureConfig) {
    setConfig(next)
    setSnapshot(controller.configure(next))
  }

  function captureGesture(label: CalibrationLabel) {
    // Actions are forbidden during observation and in the short settling time.
    activeCaptureRef.current = {
      label, starts: performance.now() + 700, ends: performance.now() + 2700, samples: [],
    }
    setCaptureLabel(label)
    setGestureCalibrationMessage('Hold ' + label + ' still, with one complete hand inside the camera view…')
    setSnapshot(controller.setEnabled(false))
  }

  function centerPointer() {
    const tracking = controller.getTracking()
    const hand = tracking.hands[0]
    if (tracking.ambiguous || tracking.hands.length !== 1 || hand.pose !== 'OPEN' || hand.orientation !== 'UPRIGHT_LIKE' || performance.now() - hand.timestampMs > config.freshnessMs) {
      setCalibrationMessage('Calibration needs one fresh upright open palm. Keep it visible and try again.')
      return
    }
    applyConfig(calibratePointer(hand.center, config))
    setCalibrationMessage('Comfortable center captured. Open your hand again to re-arm.')
  }

  return <GesturePlayground
    cameraControls={<>
      <CameraManager onFrame={handleFrame} onInactive={cancel} onDebugChange={enabled => { cancel(); setDebugEnabled(enabled) }} />
      <button className="pause-gestures" onClick={() => {
        setPaused(!paused)
        setSnapshot(controller.setEnabled(paused))
      }}>{paused ? 'Resume gestures' : 'Pause gestures'}</button>
    </>}
    snapshot={snapshot}
    cardPosition={cardPosition}
    activations={activations}
    palette={palette}
    onActivate={id => { cancel(); activateDemo(id) }}
    onManualDrag={delta => { cancel(); moveCard(delta) }}
    arenaRef={arenaRef}
    scrollRef={scrollRef}
  >
    {debugEnabled && <section className="movement-settings" aria-label="Gesture movement calibration">
      <h2>Personal gesture calibration</h2>
      <p>{gestureCalibrationMessage}</p>
      <div className="gesture-calibration-controls">
        <button disabled={captureLabel !== null} onClick={() => captureGesture('OPEN_UPRIGHT')}>1 · Record upright OPEN</button>{' '}
        <button disabled={captureLabel !== null} onClick={() => captureGesture('FIST')}>2 · Record closed FIST</button>{' '}
        <button disabled={captureLabel !== null} onClick={() => captureGesture('OPEN_FLAT')}>3 · Record flat OPEN</button>
      </div>
      <p>{calibrated ? 'Personal recognizer active' : 'Using generic recognition until three distinct poses are recorded.'}
        {' · '}Upright {capturedCounts.OPEN_UPRIGHT} / Fist {capturedCounts.FIST} / Flat {capturedCounts.OPEN_FLAT} samples
      </p>
      <button disabled={captureLabel !== null} onClick={() => {
        activeCaptureRef.current = null
        capturesRef.current = { OPEN_UPRIGHT: [], FIST: [], OPEN_FLAT: [] }
        setCapturedCounts({ OPEN_UPRIGHT: 0, FIST: 0, OPEN_FLAT: 0 })
        setCalibrated(false)
        setSnapshot(controller.setProfile(null))
        setGestureCalibrationMessage('Personal calibration cleared; generic recognition restored.')
      }}>Clear gesture calibration</button>
      <h2>Movement calibration</h2>
      <p>{calibrationMessage}</p>
      <button onClick={centerPointer}>Center pointer reach</button>{' '}
      <button onClick={() => { applyConfig({ ...DEFAULT_GESTURE_CONFIG }); setCalibrationMessage('Default movement restored.') }}>Restore defaults</button>
      <label>Scroll speed <input type="range" min="100" max="900" step="50" value={config.maxScrollSpeed}
        onChange={event => applyConfig({ ...config, maxScrollSpeed: Number(event.target.value) })} /> {config.maxScrollSpeed} px/s</label>
      <label>Scroll dead zone <input type="range" min="0.02" max="0.20" step="0.005" value={config.scrollDeadZone}
        onChange={event => applyConfig({ ...config, scrollDeadZone: Number(event.target.value) })} /> {(config.scrollDeadZone * 100).toFixed(1)}%</label>
      <p>Actions: {paused ? 'paused' : 'enabled'} · {snapshot.mode} · {snapshot.reason}</p>
      <p><strong>ACTUAL CONTROL CLASSIFIER:</strong> {liveGestureDiagnostics}</p>
      <p><strong>Locked target:</strong> {snapshot.focusId ?? 'none'} · Pointer: {snapshot.pointer
        ? `${Math.round(snapshot.pointer.x)} × ${Math.round(snapshot.pointer.y)} px`
        : 'not armed'} · The A/B diagnostic classifiers above do not trigger controls.</p>
      <p>Camera processing and calibration stay in this browser. Evaluation recording pauses all gesture actions. Escape pauses gestures immediately.</p>
    </section>}
    {debugEnabled && snapshot.pointer && <div aria-hidden="true" style={{
      position: 'fixed',
      pointerEvents: 'none',
      left: snapshot.pointer.x - 10,
      top: snapshot.pointer.y - 10,
      width: 20,
      height: 20,
      borderRadius: '50%',
      border: '2px solid #38e8f5',
      boxShadow: '0 0 14px #38e8f5',
      zIndex: 99999,
    }} />}
  </GesturePlayground>
}
