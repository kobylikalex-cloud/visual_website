import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react'
import type { InteractionSnapshot } from '../control/types'
import type { ClickState } from '../control/FistClickEngine'
import type { PageInteractionState } from '../control/PageGestureEngine'
import './playground.css'

export type GesturePlaygroundProps = {
  cameraControls: ReactNode
  snapshot: InteractionSnapshot & { clickState?: ClickState; interactionState?: PageInteractionState }
  scrollTestPage?: boolean
  cardPosition: { x: number; y: number }
  activations: number
  buttonActivations: Record<string, number>
  palette: 'violet' | 'mint' | 'amber'
  onActivate: (id: string) => void
  onManualDrag: (delta: { x: number; y: number }) => void
  scrollRef: RefObject<HTMLDivElement | null>
  arenaRef: RefObject<HTMLDivElement | null>
  children?: ReactNode
}

const readingSections = [
  { title: 'One gesture at a time.', category: 'SPRINT 03', text: 'Raise one clearly open hand to aim. A complete fist activates a focused button once. Rotate to a flat open palm and move up or down to start scrolling. Return to the starting height to stop, or turn upright to aim again.' },
  { title: 'A steady place to begin.', category: '01 / HOLD', text: 'Keep the whole palm visible and hold still for ten seconds. In debug mode, record stationary pointer variation and focus interruptions.' },
  { title: 'Make movement comfortable.', category: '02 / CALIBRATE', text: 'Capture a comfortable center in debug mode and adjust the camera movement range. A larger range lowers pointer gain. Recognition thresholds stay unchanged.' },
  { title: 'Move between the five targets.', category: '03 / MOVE', text: 'Try slow horizontal and vertical movement, then faster movement. Notice whether feedback follows smoothly and whether focus remains steady.' },
  { title: 'Disengage safely.', category: '04 / RELEASE', text: 'Remove the hand, briefly occlude it, then return. Stale observations stop movement. Partial closure, unknown pose or a second hand must not activate anything. Dragging and two-hand gestures remain disabled.' },
  { title: 'Native input stays available.', category: '05 / INPUT', text: 'Use mouse, touch or keyboard to activate buttons, move the card and read these notes. Escape pauses pointer feedback.' },
]
const modeLabels: Record<InteractionSnapshot['mode'], string> = {
  IDLE: 'Standing by', UNCERTAIN: 'Finding your hand', POINTER: 'Ready to aim',
  GRASP_PENDING: 'Hold your grasp', GRABBING: 'Holding an object',
  SCROLL: 'Scroll mode', SCROLL_FAST: 'Fast scroll · 3×',
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M5 12h14m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export default function GesturePlayground({ cameraControls, snapshot, scrollTestPage = false, cardPosition, activations, buttonActivations, palette, onActivate, onManualDrag, scrollRef, arenaRef, children }: GesturePlaygroundProps) {
  const dragPoint = useRef<{ id: number; x: number; y: number } | null>(null)
  const [manualDragging, setManualDragging] = useState(false)
  const statusReason = snapshot.mode === 'IDLE' && snapshot.reason === 'Reset'
    ? 'Start camera to begin.'
    : snapshot.reason || 'Start camera to begin.'
  const clickLabels: Partial<Record<ClickState, string>> = { TARGET_FOCUSED: 'Ready to activate', FIST_TRANSITION: 'Confirming fist', FIST_CONFIRMED: 'Fist confirmed', CLICK: 'Activated', WAIT_FOR_RELEASE: 'Open your hand to release' }
  const statusLabel = snapshot.interactionState === 'SCROLL_ENTRY' ? 'Flat palm · move to scroll'
    : snapshot.interactionState === 'SCROLL_ACTIVE' ? snapshot.scrollVelocity === 0 ? 'Scroll neutral' : snapshot.scrollVelocity < 0 ? 'Scrolling up' : 'Scrolling down'
    : snapshot.clickState && clickLabels[snapshot.clickState] || modeLabels[snapshot.mode]
  const gestureStyle = (id: string): CSSProperties => ({ '--proximity': Math.max(0, Math.min(1, snapshot.proximity[id] ?? 0)) } as CSSProperties)
  const targetClass = (id: string, base: string) => `${base} gesture-target${snapshot.focusId === id ? ' is-focused' : ''}`

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragPoint.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    setManualDragging(true)
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const previous = dragPoint.current
    if (!previous || previous.id !== event.pointerId) return
    onManualDrag({ x: event.clientX - previous.x, y: event.clientY - previous.y })
    dragPoint.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (dragPoint.current?.id !== event.pointerId) return
    dragPoint.current = null
    setManualDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function keyboardDrag(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 24 : 8
    const deltas: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    }
    if (deltas[event.key]) { event.preventDefault(); onManualDrag(deltas[event.key]) }
  }

  return <main className={`playground palette-${palette}`}>
    {(snapshot.interactionState === 'SCROLL_ENTRY' || snapshot.interactionState === 'SCROLL_ACTIVE') && <aside className="page-scroll-feedback" role="status" aria-live="polite">
      <span aria-hidden="true">{snapshot.scrollVelocity < 0 ? '↑' : snapshot.scrollVelocity > 0 ? '↓' : '↕'}</span>
      <div>{statusLabel}<small>{snapshot.interactionState === 'SCROLL_ENTRY' ? 'Move your flat hand up or down' : snapshot.scrollVelocity === 0 ? 'Move above or below this resting height' : 'Return to resting height to stop'}</small></div>
    </aside>}
    <div className="playground-shell">
      <header className="playground-header">
        <a className="brand" href="#playground" aria-label="Gesture Lab home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>gesture<span className="brand-light">lab</span><span className="brand-dot">.</span></span>
        </a>
        <div className="header-label"><span className="tiny-orbit" aria-hidden="true" /> An experiment in natural interaction</div>
        <span className="edition">SPRINT / 03</span>
      </header>

      <section className="playground-intro" id="playground" aria-labelledby="playground-title">
        <div className="intro-copy">
          <p className="eyebrow"><span /> BEYOND THE CURSOR</p>
          <h1 id="playground-title">One hand.<br /><span>Steady focus.</span></h1>
          <p className="intro-description">Raise one open hand. Move between the targets.<br className="desktop-break" /> Hold a complete fist to activate. Reopen to repeat.</p>
        </div>
        <aside className="session-panel" aria-label="Camera and interaction controls">
          <div className="session-heading"><span className="eyebrow">YOUR SESSION</span><span className="session-icon" aria-hidden="true">↗</span></div>
          <div className="camera-controls">{cameraControls}</div>
          <div className="interaction-status" role="status" aria-live="polite" aria-atomic="true" title={snapshot.reason}>
            <span className={`status-dot${snapshot.mode !== 'IDLE' && snapshot.mode !== 'UNCERTAIN' ? ' is-active' : ''}`} />
            <span>{statusLabel}<small>{statusReason}</small></span>
          </div>
        </aside>
      </section>

      <div className="gesture-primer" aria-label="Gesture quick guide">
        <div><span className="primer-symbol" aria-hidden="true">↗</span><p><strong>Open hand</strong><span>Aim at a control</span></p></div>
        <div><span className="primer-symbol primer-grasp" aria-hidden="true">◇</span><p><strong>Close to activate</strong><span>Hold a fist · reopen to repeat</span></p></div>
        <div><span className="primer-symbol" aria-hidden="true">⇅</span><p><strong>Flat to scroll</strong><span>Move up / down from resting height</span></p></div>
        <p className="escape-hint"><kbd>esc</kbd> to pause</p>
      </div>

      <section className="pointer-test-area" aria-label="Five target pointer acceptance area">
        <div className="section-heading"><h2>Move between five targets</h2><span>OPEN → FIST → CLICK</span></div>
        <div className="pointer-target-grid">{['North west', 'North east', 'Center', 'South west', 'South east'].map((label, index) => {
          const id = 'test-' + index
          return <button key={id} className={targetClass(id, 'pointer-test-button pointer-target-' + index)} style={gestureStyle(id)} data-gesture-target={id} data-gesture-kind="click" onClick={() => onActivate(id)}><span>0{index + 1}</span>{label}<small>{buttonActivations[id] ?? 0} activations · mouse / keyboard welcome</small>{(buttonActivations[id] ?? 0) > 0 && <span key={buttonActivations[id]} className="activation-flash" aria-hidden="true" />}</button>
        })}</div>
        <p>Aim with an open palm. Let the target settle, close a complete fist, then reopen. Flat palms scroll the page. <a href={scrollTestPage ? '/' : '/scroll-test'}>{scrollTestPage ? 'Return to playground' : 'Open the long scrolling test'}</a></p>
      </section>
      <div className="experiment-grid">
        <section className="interaction-experiments" aria-labelledby="interaction-title">
          <div className="section-heading"><h2 id="interaction-title">A space to play</h2><span>01 — INTERACT</span></div>
          <div className="action-panel">
            <div className="action-panel-heading"><div><p className="eyebrow">MAKE A CONNECTION</p><h3>Start with a little pulse.</h3></div><span className="activation-count" aria-live="polite" aria-label={`${activations} activations`}>{String(activations).padStart(2, '0')}<small>activations</small></span></div>
            <p className="panel-description">Native input playground. Use mouse or keyboard to activate.</p>
            <div className="demo-actions">
              <button className={targetClass('pulse', 'pulse-button')} style={gestureStyle('pulse')} data-gesture-target="pulse" data-gesture-kind="click" onClick={() => onActivate('pulse')}>
                <span className="pulse-glyph" aria-hidden="true"><i /><i /></span><span>Send a pulse</span><Arrow />
              </button>
              <button className={targetClass('palette', 'palette-button')} style={gestureStyle('palette')} data-gesture-target="palette" data-gesture-kind="click" onClick={() => onActivate('palette')} aria-label="Change the playground color palette">
                <span className="color-swatches" aria-hidden="true"><i /><i /><i /></span><span>Shift the mood</span><span className="palette-label">{palette}</span>
              </button>
            </div>
          </div>

          <div className="movement-panel">
            <div className="movement-heading"><div><p className="eyebrow">GIVE IT SOME SPACE</p><h3>A little room to move.</h3></div><span className="movement-icon" aria-hidden="true">⤢</span></div>
            <div className="drag-arena" ref={arenaRef}>
              <div className="arena-cross arena-cross-a" aria-hidden="true" /><div className="arena-cross arena-cross-b" aria-hidden="true" />
              <div className="arena-orbit" aria-hidden="true" />
              <button className={`${targetClass('orbit-card', 'orbit-card')}${manualDragging || snapshot.mode === 'GRABBING' && snapshot.focusId === 'orbit-card' ? ' is-dragging' : ''}`} style={{ ...gestureStyle('orbit-card'), transform: `translate(calc(-50% + ${cardPosition.x}px), calc(-50% + ${cardPosition.y}px))` }} data-gesture-target="orbit-card" data-gesture-kind="drag" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={keyboardDrag} aria-label="Orbit card. Drag to move, or use arrow keys. Hold Shift for larger steps." aria-describedby="drag-instructions">
                <span className="card-topline"><span className="card-orbit-mark" aria-hidden="true" /><span>OBJECT / 001</span><Arrow diagonal /></span>
                <span className="card-title">Go with<br />the motion.</span>
                <span className="card-bottom"><span>Mouse or keyboard.</span><span aria-hidden="true">⠿</span></span>
              </button>
              <span className="arena-caption">YOUR LITTLE CORNER OF THE UNIVERSE</span>
            </div>
            <div className="movement-footer"><p id="drag-instructions">Mouse and keyboard movement remain available.<span>Or drag with a mouse · arrow keys to move</span></p><button className={targetClass('reset', 'reset-button')} style={gestureStyle('reset')} data-gesture-target="reset" data-gesture-kind="click" onClick={() => onActivate('reset')}><span aria-hidden="true">↺</span> Reset</button></div>
          </div>
        </section>

        <section className="reading-experiment" aria-labelledby="reading-title">
          <div className="section-heading"><h2 id="reading-title">Find your flow</h2><span>02 — EXPLORE</span></div>
          <div className={`reading-panel${snapshot.mode === 'SCROLL' || snapshot.mode === 'SCROLL_FAST' ? ' is-scrolling' : ''}`}>
            <div className="reading-toolbar"><div><span className="reading-live-dot" /> FIELD NOTES</div><span>SCROLL TO DISCOVER <span aria-hidden="true">↓</span></span></div>
            <div className="reading-viewport" ref={scrollRef} tabIndex={0} role="region" aria-label="Scrollable field notes. Use mouse wheel or keyboard. Gestures scroll the whole page.">
              <div className="journal-cover"><span className="journal-edition">THE GESTURE JOURNAL — VOL. 01</span><div className="journal-art" aria-hidden="true"><i /><i /><i /><span /></div><p>Follow your<br /><em>natural instinct.</em></p><div className="journal-cover-bottom"><span>THOUGHTS ON MOVEMENT<br />& THE SPACES IN BETWEEN</span><span aria-hidden="true">↙</span></div></div>
              <div className="journal-content">{readingSections.map((section, index) => <article className="journal-entry" key={section.category}><p className="eyebrow">{section.category}</p><h3>{section.title}</h3><p>{section.text}</p>{index === 3 && <blockquote>“The interface should feel like<br />it is listening.”</blockquote>}</article>)}<p className="journal-end">END OF NOTES <span aria-hidden="true">✳</span> BEGIN AGAIN</p></div>
            </div>
            <div className="reading-footer"><span aria-hidden="true">⇅</span><span>Native wheel here · flat palm scrolls the whole page</span></div>
          </div>
        </section>
      </div>

      {children && <section className="playground-diagnostics" aria-label="Calibration and diagnostics">{children}</section>}

      {scrollTestPage && <section className="scroll-test-course" aria-label="Long page scrolling acceptance course">
        <div className="section-heading"><h2>A little space to find your flow.</h2><span>SCROLL / PRACTICE</span></div>
        {[
          ['01 / BEGIN', 'Start with a movement.', 'Show one flat open hand and move up or down. Your starting height becomes the resting point; no still-hold is required.'],
          ['02 / DIRECTION', 'Follow the height of your hand.', 'Lower your hand a little to travel down this page. Raise it above its resting height to travel upward.'],
          ['03 / CONTINUOUS', 'Set a pace. Keep it.', 'Hold your hand away from neutral to keep moving. A larger displacement increases the pace. There is no need to keep swiping.'],
          ['04 / STOP', 'Come back to stillness.', 'Return to the resting height. The page should stop immediately, without coasting.'],
          ['05 / SWITCH', 'A natural change of intention.', 'Turn the open palm upright to leave scrolling. The pointer will confirm before it resumes. A fist while scrolling should never click.'],
          ['06 / RECOVER', 'Take a break. Begin again.', 'Lower your hand out of view. Return with a flat open palm and begin a new up or down stroke. Previous scrolling does not resume by itself.'],
          ['07 / RETURN', 'Find your way back.', 'Raise the hand above neutral and travel back to the top. Turn upright, aim at a test button, close a complete fist, then reopen.'],
        ].map(([category, title, text]) => <article key={category}><p className="eyebrow">{category}</p><h2>{title}</h2><p>{text}</p></article>)}
      </section>}

      <footer className="playground-footer"><span><span className="footer-star" aria-hidden="true">✳</span> Made for a more human interaction.</span><span>Mouse & keyboard always welcome.</span></footer>
    </div>
  </main>
}
