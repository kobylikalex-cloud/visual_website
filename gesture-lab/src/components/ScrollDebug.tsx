import { useState } from 'react'
import type { PageGestureEngine } from '../control/PageGestureEngine'
import type { PageScrollConfig } from '../control/PageScrollSession'

type Props = { diagnostics: PageGestureEngine['scrollDiagnostics']; feedback: { median: number | null; p95: number | null };
  onConfigure(config: PageScrollConfig): void; onCapture(): void; onReset(): void; onDefaults(): void }
const fmt = (n: number | null) => n === null ? 'unavailable' : n.toFixed(1)

/** Debug-only calibration: never stores video or landmarks. */
export default function ScrollDebug({ diagnostics: d, feedback, onConfigure, onCapture, onReset, onDefaults }: Props) {
  const [message, setMessage] = useState('Optional posture calibration: hold the open flat palm still, then capture. Normal scrolling starts with a flat up/down movement; its starting height becomes neutral.')
  function capture() {
    try { onCapture(); setMessage('Flat posture captured for this session. Move the flat hand up or down to begin a new scroll stroke.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Posture capture unavailable') }
  }
  function download() {
    const blob = new Blob([JSON.stringify({ build: __GESTURE_BUILD__, scroll: d, captureToScrollApplicationMs: feedback,
      note: 'Local numeric metrics only, including up to400 debug-only observation summaries (palm height, pose, orientation, state and source age). No video or21-point landmarks. Software scroll application is not camera-to-photon latency. Transitions require manual interpretation.' }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'gesture-sprint03-scroll.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const neutral = d.neutralY ?? .5
  return <section className="movement-settings scroll-debug" aria-label="Scroll calibration and diagnostics">
    <h2>Page scrolling · calibration</h2><p role="status">{message}</p>
    <div className="scroll-calibration-actions"><button onClick={capture}>Capture flat posture</button><button onClick={onReset}>Reset scroll neutral</button><button onClick={() => { onDefaults(); setMessage('Default scroll posture and movement settings restored.') }}>Restore scroll defaults</button></div>
    <label>Scroll dead zone <input aria-label="Scroll dead zone" type="range" min="0.01" max={Math.min(.08, d.config.range - .01)} step="0.005" value={d.config.deadZone}
      onChange={e => onConfigure({ ...d.config, deadZone: Number(e.target.value) })} /> {(d.config.deadZone * 100).toFixed(1)}%</label>
    <label>Scroll displacement range <input aria-label="Scroll displacement range" type="range" min={Math.max(.06, d.config.deadZone + .01)} max="0.30" step="0.01" value={d.config.range}
      onChange={e => onConfigure({ ...d.config, range: Number(e.target.value) })} /> {(d.config.range * 100).toFixed(0)}%</label>
    <label>Maximum scroll speed <input aria-label="Maximum scroll speed" type="range" min="100" max="1800" step="50" value={d.config.maxSpeed}
      onChange={e => onConfigure({ ...d.config, maxSpeed: Number(e.target.value) })} /> {d.config.maxSpeed} px/s</label>
    <div className="scroll-metric-layout"><div className="scroll-neutral-preview" aria-label="Normalized palm height and neutral band">
      <span className="neutral-band" style={{ top: `${Math.max(0, neutral - d.config.deadZone) * 100}%`, height: `${d.config.deadZone * 200}%` }} />
      <span className="neutral-line" style={{ top: `${neutral * 100}%` }} />
      <span className="palm-height-line" style={{ top: `${Math.max(0, Math.min(1, neutral + d.displacement)) * 100}%` }} />
    </div><div><p>Mode: <strong>{d.mode}</strong> · {d.reason}</p>
      <p>Neutral height: {d.neutralY === null ? 'not captured' : d.neutralY.toFixed(3)} · displacement: {(d.displacement * 100).toFixed(1)}% · velocity: {d.velocity.toFixed(0)} px/s</p>
      <p>Depth: {fmt(d.metrics?.depthTiltDegrees ?? null)}° · palm facing: {fmt(d.metrics?.palmFacingCameraPercent ?? null)}%. Entry ≥{d.profile.enterDepth.toFixed(0)}° / ≤{d.profile.enterFacing.toFixed(0)}%; retained only after entry above {d.profile.exitDepth.toFixed(0)}°.</p>
      <p>Capture-to-first page scroll application median / p95: {fmt(feedback.median)} / {fmt(feedback.p95)} ms. Software timing, not physical display latency.</p>
      <p>Mode transitions: {d.transitionCount}. Tracking, inference, RAF cadence and long tasks appear below.</p></div></div>
    <p>Local debug trace: {d.observations.length}/400 numeric observations. Contains palm height, pose, orientation and state; no video or hand landmarks. Cleared when debug closes.</p>
    <details><summary>Recent mode transitions</summary><ol>{d.transitions.map((t, i) => <li key={`${t.time}-${i}`}>{t.time.toFixed(0)} ms · {t.state} · {t.reason}</li>)}</ol></details>
    <button onClick={download}>Download local scroll metrics</button>
    <p>Scrolling targets the whole webpage. Native wheel, touch and keyboard remain available. Calibration is session-only; pointer gain and finger thresholds are independent.</p>
  </section>
}
