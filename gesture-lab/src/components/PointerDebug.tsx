import type { PointerDiagnostics } from '../control/OpenPointerEngine'
import type { InteractionSnapshot } from '../control/types'
import type { PointerMeasurement } from '../evaluation/PointerMeasurement'
import type { PerformanceReport } from '../tracking/TrackingPerformance'
import type { BenchmarkReport } from '../tracking/protocol'

const number = (value: number | null | undefined) => value == null ? 'unavailable' : value.toFixed(1)

export default function PointerDebug({ diagnostics: d, snapshot, perf, backend, benchmark, measurement: m, feedback }: {
  diagnostics: PointerDiagnostics; snapshot: InteractionSnapshot; perf: PerformanceReport | null; backend: string; benchmark: BenchmarkReport | null; measurement: PointerMeasurement; feedback: { median: number | null; p95: number | null }
}) {
  const center = m.points.reduce((sum, p) => ({ x: sum.x + p.x / m.points.length, y: sum.y + p.y / m.points.length }), { x: 0, y: 0 })
  const rms = m.points.length ? Math.sqrt(m.points.reduce((sum, p) => sum + (p.x - center.x) ** 2 + (p.y - center.y) ** 2, 0) / m.points.length) : null
  function download() {
    const blob = new Blob([JSON.stringify({ build: __GESTURE_BUILD__, backend, performance: perf, benchmark, pointer: d, softwareFeedbackMs: feedback,
      measurement: { mode: m.mode, samples: m.points.length, frames: m.frames, interruptions: m.interruptions, focusChanges: m.switches, stationaryRmsPx: m.mode === 'stationary' ? rms : null },
      note: 'Local numeric summary only. Capture-to-feedback is a software estimate, not physical camera-to-photon latency.' }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'gesture-sprint01-measurements.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="movement-settings pointer-debug" data-pointer-debug aria-label="Pointer recognition and performance">
    <div id="debug-interaction-point" aria-hidden="true" />
    <h2>OPEN_UPRIGHT · developer observation</h2>
    <p>Build: {__GESTURE_BUILD__.branch} · {__GESTURE_BUILD__.commit.slice(0, 7)}{__GESTURE_BUILD__.dirty ? ' + local changes' : ''}</p>
    <p>Raw: <strong>{d.raw}</strong> · confirmed: <strong>{String(d.confirmed)}</strong> · spatial hand ID: {d.handId ?? 'none'}</p>
    <p>Quality: {d.quality} · observation age: {number(d.observationAgeMs)} ms. Geometry validity is not a calibrated confidence probability.</p>
    <p>Point: {snapshot.pointer ? `${number(snapshot.pointer.x)}, ${number(snapshot.pointer.y)} px` : 'stopped'} · focus: {snapshot.focusId ?? 'none'} · distance to target edge: {number(d.distance)} px</p>
    <p>Configured delegate: {backend}. No NPU backend is enabled. Hardware GPU utilization is not independently measured.</p>
    <p>Capture-to-first CSS feedback median / p95: {number(feedback.median)} / {number(feedback.p95)} ms. Includes transport and first render callback; filter settling is additional.</p>
    {perf && <>
      <p>UI RAF cadence: {number(perf.renderFps)} FPS · interval p95 {number(perf.renderInterval.p95)} ms · processed: {number(perf.processedFps)} FPS · presented camera: {number(perf.cameraFps)} FPS</p>
      <p>Inference median / p95: {number(perf.inference.median)} / {number(perf.inference.p95)} ms</p>
      <p>Result processing median / p95: {number(perf.processing.median)} / {number(perf.processing.p95)} ms · capture-to-publication: {number(perf.delivery.median)} / {number(perf.delivery.p95)} ms</p>
      <p>Frames processed {perf.processedFrames} / camera {perf.cameraFrames}; unprocessed {perf.unprocessedCameraFrames} (includes deliberate rate limiting). Rejected: busy {perf.drops.busy}, stale {perf.drops.stale}, transfer {perf.drops.transfer}. Main-thread long tasks: {perf.longTaskCount} / {number(perf.longTaskMs)} ms {typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask') ? '' : '(API unavailable)'}</p>
    </>}
    {benchmark && <p>Same-frame comparison ({benchmark.samples} measured frames, five warmups excluded): CPU median/p95 {number(benchmark.CPU?.median)}/{number(benchmark.CPU?.p95)} ms · GPU {number(benchmark.GPU?.median)}/{number(benchmark.GPU?.p95)} ms. {benchmark.unavailable.join('; ')}</p>}
    <p>Acceptance: {m.mode}{m.complete ? ' · complete' : ''} · frames {m.frames} · confirmation losses {m.interruptions} · focus exits/switches {m.switches} · stationary pointer RMS {m.mode === 'stationary' ? number(rms) : 'select stationary test'} px ({m.points.length} samples, bounded to 1800).</p>
    <p>RAF measures main-thread callback cadence; it does not prove physical display presentation. Capture timestamp precedes bitmap transfer; camera exposure and display latency are unavailable.</p>
    <button onClick={download}>Download local measurement summary</button>
  </section>
}
