
import { useCallback, useEffect, useRef, useState } from 'react'
import CameraManager from './components/CameraManager'
import GesturePlayground from './components/GesturePlayground'
import { PlaygroundController } from './control/PlaygroundController'
import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './control/GestureConfig'
import { calibratePointer, constrainCardPosition } from './control/MovementCalibration'
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

  useEffect(() => {
    controller.setEffects({ activate: activateDemo, dragBy: moveCard,
      scrollBy: deltaY => scrollRef.current?.scrollBy({ top: deltaY, behavior: 'instant' }) })
  }, [controller, activateDemo, moveCard])

  const cancel = useCallback(() => setSnapshot(controller.cancel()), [controller])
  const handleFrame = useCallback((frame: TrackingFrame) => {
    if (document.hidden || !document.hasFocus()) { cancel(); return }
    const targets: InteractionTarget[] = Array.from(document.querySelectorAll<HTMLElement>('[data-gesture-target]')).flatMap(element => {
      if (!element.getClientRects().length) return []
      const rect = element.getBoundingClientRect()
      if (!['pulse', 'palette', 'reset', 'orbit-card'].includes(element.dataset.gestureTarget ?? '') ||
        rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return []
      return [{ id: element.dataset.gestureTarget!, kind: element.dataset.gestureKind === 'drag' ? 'drag' as const : 'click' as const,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        disabled: element.matches(':disabled, [aria-disabled="true"]') }]
    })
    setSnapshot(controller.update(frame, targets, { width: window.innerWidth, height: window.innerHeight }, performance.now()))
  }, [controller, cancel])

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
      <h2>Movement calibration</h2>
      <p>{calibrationMessage}</p>
      <button onClick={centerPointer}>Center pointer reach</button>{' '}
      <button onClick={() => { applyConfig({ ...DEFAULT_GESTURE_CONFIG }); setCalibrationMessage('Default movement restored.') }}>Restore defaults</button>
      <label>Scroll speed <input type="range" min="100" max="900" step="50" value={config.maxScrollSpeed}
        onChange={event => applyConfig({ ...config, maxScrollSpeed: Number(event.target.value) })} /> {config.maxScrollSpeed} px/s</label>
      <label>Scroll dead zone <input type="range" min="0.02" max="0.20" step="0.005" value={config.scrollDeadZone}
        onChange={event => applyConfig({ ...config, scrollDeadZone: Number(event.target.value) })} /> {(config.scrollDeadZone * 100).toFixed(1)}%</label>
      <p>Actions: {paused ? 'paused' : 'enabled'} · {snapshot.mode} · {snapshot.reason}</p>
      <p>Camera processing and calibration stay in this browser. Evaluation recording pauses all gesture actions. Escape pauses gestures immediately.</p>
    </section>}
  </GesturePlayground>
}
