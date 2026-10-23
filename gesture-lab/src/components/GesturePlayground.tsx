import { useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react'
import type { InteractionSnapshot } from '../control/types'
import './playground.css'

export type GesturePlaygroundProps = {
  cameraControls: ReactNode
  snapshot: InteractionSnapshot
  cardPosition: { x: number; y: number }
  activations: number
  palette: 'violet' | 'mint' | 'amber'
  onActivate: (id: string) => void
  onManualDrag: (delta: { x: number; y: number }) => void
  scrollRef: RefObject<HTMLDivElement | null>
  arenaRef: RefObject<HTMLDivElement | null>
  children?: ReactNode
}

const readingSections = [
  { title: 'A little less interface. A little more instinct.', category: 'THE IDEA', text: 'The best interactions feel almost invisible. Here, movement becomes an input and the interface quietly responds. Start with something small: aim at a button, notice its response, then close your hand to activate it.' },
  { title: 'Make room for a different kind of input.', category: '01 / SPACE', text: 'Sit comfortably with a little room around your hands. Keep your whole hand in view, with even light and an uncluttered background. A relaxed, deliberate movement is easier to follow than a quick one.' },
  { title: 'Let the surface come to you.', category: '02 / ATTENTION', text: 'Hold an open hand upright and move it gently to aim. Nearby controls brighten before you reach them. The response lives on the control itself, so your attention stays on what you are doing.' },
  { title: 'One small gesture. One clear intention.', category: '03 / ACTIVATE', text: 'Aim at the pulse control with an upright open hand. Close into a fist to activate it. Open your hand again before your next action. The counter keeps a simple record of each activation.' },
  { title: 'Pick it up. Find a new place.', category: '04 / MOVEMENT', text: 'Bring your attention to the floating card, close your hand, and hold the grasp as you move. Open your hand to release. The card stays inside its space, ready for the next movement.' },
  { title: 'Reading has its own rhythm.', category: '05 / FLOW', text: 'Turn an open hand into a flat, horizontal position to enter scroll mode. Move above or below the neutral band to travel through this journal. Returning toward the middle slows the movement to a stop.' },
  { title: 'A faster way through.', category: '06 / MOMENTUM', text: 'Two flat open hands moving in the same direction unlock three times the scrolling speed. It is a useful way to cover more ground. To return to one-hand scrolling, lower both hands first, then raise one flat open hand and hold it steady to establish a fresh neutral position.' },
  { title: 'A pause is part of the interaction.', category: '07 / STILLNESS', text: 'Press Escape whenever you need to pause gesture interactions. Mouse, touch, and keyboard controls remain available. Nothing here asks you to get every movement right on the first try.' },
  { title: 'Back to the beginning.', category: '08 / AGAIN', text: 'Try a new color, move the card somewhere unexpected, or reset the playground and begin again. This is a space for curiosity. Small experiments are enough.' },
]

const modeLabels: Record<InteractionSnapshot['mode'], string> = {
  IDLE: 'Standing by', UNCERTAIN: 'Finding your hand', POINTER: 'Ready to aim',
  GRASP_PENDING: 'Hold your grasp', GRABBING: 'Holding an object',
  SCROLL: 'Scroll mode', SCROLL_FAST: 'Fast scroll · 3×',
}

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal ? 'M6 18 18 6M6 6h12v12' : 'M5 12h14m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export default function GesturePlayground({ cameraControls, snapshot, cardPosition, activations, palette, onActivate, onManualDrag, scrollRef, arenaRef, children }: GesturePlaygroundProps) {
  const dragPoint = useRef<{ id: number; x: number; y: number } | null>(null)
  const [manualDragging, setManualDragging] = useState(false)
  const statusReason = snapshot.mode === 'IDLE' && snapshot.reason === 'Reset'
    ? 'Start camera to begin.'
    : snapshot.reason || 'Start camera to begin.'
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
    <div className="playground-shell">
      <header className="playground-header">
        <a className="brand" href="#playground" aria-label="Gesture Lab home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>gesture<span className="brand-light">lab</span><span className="brand-dot">.</span></span>
        </a>
        <div className="header-label"><span className="tiny-orbit" aria-hidden="true" /> An experiment in natural interaction</div>
        <span className="edition">PLAYGROUND / 01</span>
      </header>

      <section className="playground-intro" id="playground" aria-labelledby="playground-title">
        <div className="intro-copy">
          <p className="eyebrow"><span /> BEYOND THE CURSOR</p>
          <h1 id="playground-title">Less clicking.<br /><span>More feeling.</span></h1>
          <p className="intro-description">A small space for a new kind of interaction.<br className="desktop-break" /> Move naturally. Watch the interface follow your lead.</p>
        </div>
        <aside className="session-panel" aria-label="Camera and interaction controls">
          <div className="session-heading"><span className="eyebrow">YOUR SESSION</span><span className="session-icon" aria-hidden="true">↗</span></div>
          <div className="camera-controls">{cameraControls}</div>
          <div className="interaction-status" role="status" aria-live="polite" aria-atomic="true" title={snapshot.reason}>
            <span className={`status-dot${snapshot.mode !== 'IDLE' && snapshot.mode !== 'UNCERTAIN' ? ' is-active' : ''}`} />
            <span>{modeLabels[snapshot.mode]}<small>{statusReason}</small></span>
          </div>
        </aside>
      </section>

      <div className="gesture-primer" aria-label="Gesture quick guide">
        <div><span className="primer-symbol" aria-hidden="true">↗</span><p><strong>Open & upright</strong><span>Aim at a control</span></p></div>
        <div><span className="primer-symbol primer-grasp" aria-hidden="true">◇</span><p><strong>Close into a fist</strong><span>Activate or grasp</span></p></div>
        <div><span className="primer-symbol" aria-hidden="true">⇅</span><p><strong>Open & flat</strong><span>Move to scroll · two hands 3×</span></p></div>
        <p className="escape-hint"><kbd>esc</kbd> to pause</p>
      </div>

      <div className="experiment-grid">
        <section className="interaction-experiments" aria-labelledby="interaction-title">
          <div className="section-heading"><h2 id="interaction-title">A space to play</h2><span>01 — INTERACT</span></div>
          <div className="action-panel">
            <div className="action-panel-heading"><div><p className="eyebrow">MAKE A CONNECTION</p><h3>Start with a little pulse.</h3></div><span className="activation-count" aria-live="polite" aria-label={`${activations} activations`}>{String(activations).padStart(2, '0')}<small>activations</small></span></div>
            <p className="panel-description">Aim with an open hand. Close to activate.</p>
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
                <span className="card-bottom"><span>Grasp. Move. Release.</span><span aria-hidden="true">⠿</span></span>
              </button>
              <span className="arena-caption">YOUR LITTLE CORNER OF THE UNIVERSE</span>
            </div>
            <div className="movement-footer"><p id="drag-instructions">Close your hand to grab. Open to let go.<span>Or drag with a mouse · arrow keys to move</span></p><button className={targetClass('reset', 'reset-button')} style={gestureStyle('reset')} data-gesture-target="reset" data-gesture-kind="click" onClick={() => onActivate('reset')}><span aria-hidden="true">↺</span> Reset</button></div>
          </div>
        </section>

        <section className="reading-experiment" aria-labelledby="reading-title">
          <div className="section-heading"><h2 id="reading-title">Find your flow</h2><span>02 — EXPLORE</span></div>
          <div className={`reading-panel${snapshot.mode === 'SCROLL' || snapshot.mode === 'SCROLL_FAST' ? ' is-scrolling' : ''}`}>
            <div className="reading-toolbar"><div><span className="reading-live-dot" /> FIELD NOTES</div><span>SCROLL TO DISCOVER <span aria-hidden="true">↓</span></span></div>
            <div className="reading-viewport" ref={scrollRef} tabIndex={0} role="region" aria-label="Scrollable field notes. Use a flat open hand, mouse wheel, or keyboard to scroll.">
              <div className="journal-cover"><span className="journal-edition">THE GESTURE JOURNAL — VOL. 01</span><div className="journal-art" aria-hidden="true"><i /><i /><i /><span /></div><p>Follow your<br /><em>natural instinct.</em></p><div className="journal-cover-bottom"><span>THOUGHTS ON MOVEMENT<br />& THE SPACES IN BETWEEN</span><span aria-hidden="true">↙</span></div></div>
              <div className="journal-content">{readingSections.map((section, index) => <article className="journal-entry" key={section.category}><p className="eyebrow">{section.category}</p><h3>{section.title}</h3><p>{section.text}</p>{index === 3 && <blockquote>“The interface should feel like<br />it is listening.”</blockquote>}</article>)}<p className="journal-end">END OF NOTES <span aria-hidden="true">✳</span> BEGIN AGAIN</p></div>
            </div>
            <div className="reading-footer"><span aria-hidden="true">⇅</span><span>One flat hand to scroll. Two for 3× speed.</span><span className="reading-speed">{snapshot.mode === 'SCROLL_FAST' ? '3×' : '1×'}</span></div>
          </div>
        </section>
      </div>

      {children && <section className="playground-diagnostics" aria-label="Calibration and diagnostics">{children}</section>}
      <footer className="playground-footer"><span><span className="footer-star" aria-hidden="true">✳</span> Made for a more human interaction.</span><span>Mouse & keyboard always welcome.</span></footer>
    </div>
  </main>
}
