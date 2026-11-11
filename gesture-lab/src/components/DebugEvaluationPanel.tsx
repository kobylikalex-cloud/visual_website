import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LocalEvaluation, summarizeEvaluation, TRUTH_LABELS, type HandLabel, type TruthLabel } from '../evaluation/LocalEvaluation'
import { RecognitionComparison, type ComparisonRow } from '../evaluation/RecognitionComparison'
import { getFingerPoseEvidence } from '../control/FingerPoseEvidence'
import { recognizeControlHand } from '../control/ControlRecognition'
import { getProjectedFingerEvidence } from '../evaluation/ProjectionEvidence'

type Props = {
  rows: ComparisonRow[]
  session: LocalEvaluation
  comparison: RecognitionComparison
  cameraActive: boolean
  onEvaluationStart?: () => void
}

function rate(value: number | null): string { return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%` }
function ms(value: number | null): string { return value === null ? 'n/a' : `${value.toFixed(1)} ms` }
const guidedInstructions: Record<TruthLabel, { title: string; instruction: string }> = {
  OPEN_FLAT: { title: 'Flach offen', instruction: 'Eine offene flache Hand zeigen. Erst ruhig halten, dann langsam hoch und runter. Keine Faust, kein Handwechsel.' },
  OPEN_UPRIGHT: { title: 'Aufrecht offen', instruction: 'Eine offene aufrechte Hand zeigen. Langsam etwas nach links und rechts drehen. Noch keine Faust.' },
  FIST: { title: 'Geschlossene Faust', instruction: 'Eine vollständige Faust halten. Langsam frontal und seitlich drehen. Nicht zwischendurch öffnen.' },
  OTHER: { title: 'Zwei Finger', instruction: 'Nur Zeige- und Mittelfinger ausstrecken; die übrigen Finger schließen. Keine offene Hand und keine vollständige Faust.' },
}

/** Mounted exclusively inside explicit debug mode. This panel has no action dispatch. */
export default function DebugEvaluationPanel({ rows, session, comparison, cameraActive, onEvaluationStart }: Props) {
  const [report, setReport] = useState<ReturnType<typeof summarizeEvaluation> | null>(null)
  const [, refresh] = useState(0)
  const [guidedView, setGuidedView] = useState<(NonNullable<LocalEvaluation['singleCapture']> & { nowMs: number; title: string }) | null>(null)
  const guidedEnd = guidedView?.endMs ?? null
  const guidedSegment = guidedView?.segmentId ?? null
  const labels = { Left: session.getLabel('Left') ?? '', Right: session.getLabel('Right') ?? '' }

  useEffect(() => {
    if (guidedEnd === null || guidedSegment === null) return
    function finish() {
      if (!session.stopSingle(guidedSegment!)) return
      setGuidedView(view => view?.segmentId === guidedSegment ? null : view)
      setReport(summarizeEvaluation(session.samples)); refresh(value => value + 1)
    }
    const timer = window.setInterval(() => {
      const nowMs = performance.now()
      if (!session.recording || nowMs >= guidedEnd!) finish()
      else setGuidedView(view => view && { ...view, nowMs })
    }, 100)
    function visibility() { if (document.hidden) finish() }
    document.addEventListener('visibilitychange', visibility)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); session.stopSingle(guidedSegment) }
  }, [guidedEnd, guidedSegment, session])

  function startGuided(truth: TruthLabel, nowMs: number, prompt = guidedInstructions[truth].instruction, title = guidedInstructions[truth].title) {
    onEvaluationStart?.(); comparison.reset()
    session.startSingle(truth, nowMs, prompt)
    setReport(null); setGuidedView({ ...session.singleCapture!, nowMs, title }); refresh(value => value + 1)
  }

  function handleLabelChange(hand: HandLabel, value: TruthLabel | '', nowMs: number) {
    session.setLabel(hand, value || null, nowMs)
    refresh(previous => previous + 1)
  }

  function stop() {
    session.stop()
    setGuidedView(null)
    setReport(summarizeEvaluation(session.samples))
    refresh(value => value + 1)
  }

  function download() {
    const summary = summarizeEvaluation(session.samples)
    const blob = new Blob([JSON.stringify({
      schemaVersion: session.samples.some(s=>s.recognitionModel==='learned') ? 4 : session.samples.some(s => s.imageLandmarks) ? 3 : session.singleCapture ? 2 : 1, source: __GESTURE_BUILD__, exportedAt: new Date().toISOString(),
      classifiers: { conservative: '99131fc', hybrid: 'a54a49e', sharedConfirmationMs: 150, scrollCandidate: 'projection-assisted shadow v1; rejected after flat-fist false positives; no control effects or temporal stabilization' },
      learnedModel: {path:'/models/gesture_recognizer.task',provenance:'/models/gesture-recognizer-provenance.json',role:'raw diagnostic winner, no score threshold, all actions paused; model scores are not calibrated correctness probabilities'},
      latencyDefinition: session.singleCapture
        ? 'scheduled end of 3-second preparation to first matching analyzed result; not physical motion latency'
        : 'manual label marker to first matching analyzed result; positive-pose segments only; not physical motion latency',
      singleHandCapture: session.singleCapture,
      coordinateDefinition: 'landmarks = inferred world XYZ; imageLandmarks = normalized image XYZ from the same result; 2D diagnostics use x*width/height, y, z=0. Capture timestamp precedes bitmap transfer, not camera exposure. Both timestamps are relative to session start.',
      poseOnly: true, summary, samples: session.samples,
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `gesture-evaluation-${new Date().toISOString().replaceAll(':', '-')}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <aside aria-label="Local recognition evaluation" style={{ marginTop: 20, padding: 16, border: '1px solid #64748b', borderRadius: 12, textAlign: 'left', fontSize: 13, overflowX: 'auto' }}>
      <h2 style={{ fontSize: 20 }}>Local recognition evaluation</h2>
      <p>Geführte Einzelhand-Messung: 3 Sekunden Vorlauf, danach 12 Sekunden Messung. Alle Gestenaktionen bleiben pausiert. Nur eine Hand zeigen; jeder Abschnitt wird separat lokal gespeichert.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{TRUTH_LABELS.map(truth => <button key={truth} disabled={!cameraActive || session.recording} onClick={() => startGuided(truth, performance.now())}>Messen: {guidedInstructions[truth].title}</button>)}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button disabled={!cameraActive || session.recording} onClick={() => startGuided('FIST', performance.now(), 'Unterarm waagerecht vor der Brust halten. Handrücken zeigt zur Decke. Faust vollständig schließen und so halten.', 'Faust FLACH – Handrücken nach oben')}>Messen: Faust flach</button>
        <button disabled={!cameraActive || session.recording} onClick={() => startGuided('OTHER', performance.now(), 'Unterarm waagerecht vor der Brust halten, Handrücken zur Decke. Nur Zeige- und Mittelfinger ausstrecken; die übrigen Finger schließen.', 'Zwei Finger FLACH – Handrücken nach oben')}>Messen: Zwei Finger flach</button>
        <button disabled={!cameraActive || session.recording} onClick={() => startGuided('OTHER', performance.now(), 'Unterarm waagerecht, Handrücken zur Decke. Drei Finger strecken, nur den Mittelfinger deutlich beugen. Diese Teilgeste darf nicht scrollen.', 'Teilgeste FLACH – ein Finger gebeugt')}>Messen: Ein Finger gebeugt</button>
      </div>
      {guidedView && createPortal(<aside aria-label="Geführte Handmessung" role="status" style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', width: 'min(640px, 90vw)', zIndex: 2000, padding: 20, background: '#121827', color: '#fff', border: '2px solid #a78bfa', borderRadius: 16, fontSize: 20, boxShadow: '0 8px 36px #0008' }}>
        <strong>{guidedView.nowMs < guidedView.startMs ? 'Vorbereiten' : 'Jetzt messen'}: {guidedView.title} · {Math.max(0, Math.ceil(((guidedView.nowMs < guidedView.startMs ? guidedView.startMs : guidedView.endMs) - guidedView.nowMs) / 1000))} s</strong>
        <p>{guidedView.prompt ?? guidedInstructions[guidedView.truth].instruction}</p>
        {rows.length !== 1 && <p style={{ padding: 12, background: '#78350f', border: '2px solid #fbbf24', borderRadius: 8, fontWeight: 700 }}>{rows.length === 0 ? 'Hand nicht erkannt – bitte die ganze Hand höher und vollständig ins Kamerabild halten.' : 'Bitte nur eine Hand im Kamerabild halten.'}</p>}
        <small>Keine Klicks oder Scrollbewegung · kein Video · nur lokal</small><br /><button onClick={stop}>Messung abbrechen</button>
      </aside>, document.body)}
      <p>Source at server/build start: {__GESTURE_BUILD__.branch} · {__GESTURE_BUILD__.commit.slice(0, 7)}{__GESTURE_BUILD__.dirty ? ' + modified worktree' : ''}</p>
      <p>A/B baselines are observational only. Controls use validated PIP/reach recognition; both A/B baselines use the same landmarks and 150 ms confirmation. Recording pauses gesture actions.</p>
      <p>Scroll-Kandidat verworfen: Die flache Faust wurde im lokalen Gegencheck teilweise als OPEN erkannt. Der Kandidat bleibt ausschließlich zum Vergleich sichtbar und steuert keine Aktion.</p>
      <table style={{ width: '100%', margin: '12px 0', textAlign: 'left' }}>
        <caption>A = conservative 99131fc · B = historical hybrid a54a49e</caption>
        <thead><tr><th>MediaPipe label</th><th>A raw / stable</th><th>B raw / stable</th><th>Control raw</th><th>Scroll-Kandidat (nur Vergleich)</th><th>Learned raw · model score</th><th>A / B compute</th></tr></thead>
        <tbody>{rows.length === 0
          ? <tr><td colSpan={7}>No current hand observations</td></tr>
          : rows.map((row, index) => <tr key={`${row.label}-${index}`}>
            <td>{row.label}{row.identityReliable ? '' : ' (ambiguous)'}</td>
            <td>{row.conservative.raw} / {row.conservative.stable}</td>
            <td>{row.hybrid.raw} / {row.hybrid.stable}</td>
            <td>{recognizeControlHand(row.landmarks).pose}</td>
            <td>{row.scrollCandidate ?? 'UNKNOWN'}</td>
            <td>{row.learnedGestures?.map(c=>`${c.categoryName} · ${c.score.toFixed(3)}`).join(', ') || 'not enabled'}</td>
            <td>{ms(row.conservative.computeMs)} / {ms(row.hybrid.computeMs)}</td>
          </tr>)}</tbody>
      </table>
      <p>Bild / 3D: Die Bildprojektion verwirft die geschätzte Tiefe und berücksichtigt das Kameraformat. Diese Werte sind reine Diagnose und steuern keine Geste.</p>
      {rows.map((row, index) => {
        const image = row.imageLandmarks ? getProjectedFingerEvidence(row.imageLandmarks, row.imageSize) : null
        const world = getFingerPoseEvidence(row.landmarks)
        return <table key={`projection-${index}`} aria-label={`${row.label} Bild und 3D Vergleich`} style={{ width: '100%', margin: '8px 0' }}>
          <caption>{row.label} · Bild / 3D · {row.imageSize?.width ?? '?'} × {row.imageSize?.height ?? '?'}</caption>
          <thead><tr><th>Finger</th><th>3D PIP / Reichweite</th><th>Bild PIP / Reichweite</th></tr></thead>
          <tbody>{world?.map((f,i) => <tr key={f.finger}><td>{f.finger}</td><td>{Math.round(f.pipAngleDegrees)}° / {Math.round(f.reachPercent)}% · {f.state}</td><td>{image ? `${Math.round(image[i].pipAngleDegrees)}° / ${Math.round(image[i].reachPercent)}%` : 'nicht messbar'}</td></tr>)}</tbody>
        </table>
      })}
      {rows.map((row, index) => <details key={`${row.label}-${index}`}>
        <summary>{row.label} finger readings · {row.orientation} (raw orientation)</summary>
        <table style={{ width: '100%' }}>
          <thead><tr><th>Finger</th><th>PIP</th><th>DIP</th><th>Reach</th><th>Palm advance</th><th>Control evidence</th></tr></thead>
          <tbody>{(getFingerPoseEvidence(row.landmarks) ?? []).map(reading => <tr key={reading.finger}>
            <td>{reading.finger}</td><td>{Math.round(reading.pipAngleDegrees)}°</td><td>{Math.round(reading.dipAngleDegrees)}°</td><td>{Math.round(reading.reachPercent)}%</td><td>{Math.round(reading.palmAdvancePercent)}%</td><td>{reading.state}</td>
          </tr>)}</tbody>
        </table>
      </details>)}
      <p>Palm advance is measured along the hand, independently of camera angle. Negative values mean a fingertip folds behind its own knuckle plane. Control raw uses all four fingers; A/B summaries still refer exclusively to the historical baselines.</p>
      <p>Optional labels refer to MediaPipe Left/Right, not screen side. OPEN labels score finger pose, grouped by upright/flat ground truth; orientation stays diagnostic. OTHER expects UNKNOWN.</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '12px 0' }}>
        {(['Left', 'Right'] as const).map(hand => <label key={hand}>
          {hand} truth{' '}
          <select aria-label={`${hand} truth`} value={labels[hand]} onChange={event => handleLabelChange(hand, event.target.value as TruthLabel | '', performance.now())}>
            <option value="">Unlabeled</option>
            {TRUTH_LABELS.map(label => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>)}
      </div>
      <p>Recording stores labeled world landmarks in bounded browser memory (10,000 hand observations). No video is recorded. Data leaves memory only through your explicit local JSON download. Debug off or camera stop ends recording.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <button disabled={!cameraActive || session.recording || (!labels.Left && !labels.Right)} onClick={() => {
          onEvaluationStart?.()
          comparison.reset()
          session.start(performance.now())
          setGuidedView(null)
          setReport(null)
          refresh(value => value + 1)
        }}>Start new labeled session</button>
        <button disabled={!session.recording} onClick={stop}>Stop labeling</button>
        <button onClick={() => setReport(summarizeEvaluation(session.samples))}>Refresh measurements</button>
        <button disabled={session.samples.length === 0} onClick={download}>Download local JSON</button>
        <button onClick={() => { session.clear(); setGuidedView(null); setReport(null); refresh(value => value + 1) }}>Clear local samples</button>
      </div>
      <p role="status">{session.recording ? 'Recording locally' : 'Not recording'} · {session.samples.length} labeled observations{!session.recording && session.samples.length >= 9999 ? ' · sample limit reached' : ''}</p>
      {report && <>
        {report.learned && <div aria-label="Learned local evaluation summary"><strong>Learned raw · actions paused</strong>
          <p>{report.learned.samples} label slots, {report.learned.missingOrAmbiguous} missing/ambiguous. Other winners including None map to UNKNOWN; no score threshold or forced Open/Fist choice.</p>
          {(['OPEN','FIST'] as const).map(pose=><p key={pose}>{pose}: FN {report.learned!.raw[pose].fn}/{report.learned!.raw[pose].positives}; FP {report.learned!.raw[pose].fp}/{report.learned!.raw[pose].negatives}.</p>)}
          <p>Marker-to-match median {ms(report.learned.raw.latency.medianMs)}, p95 {ms(report.learned.raw.latency.p95Ms)}; unrecognized {report.learned.raw.latency.unrecognized}/{report.learned.raw.latency.segments}. This is not physical latency or temporal confirmation.</p>
        </div>}
        <p>Summary snapshot: {report.samples} observations · {report.missingOrAmbiguous} missing/ambiguous. {session.singleCapture ? 'One hand is expected. Missing or multiple hands yield UNKNOWN; this is not proof of a finger-classification error.' : 'A missing labeled hand is UNKNOWN and counts as a false negative for OPEN/FIST.'}</p>
        <table style={{ width: '100%', margin: '12px 0' }}>
          <caption>One-vs-rest errors; n/a means no denominator. Wrong known poses count as both FP and FN.</caption>
          <thead><tr><th>Pipeline</th><th>Pose</th><th>FN / positives</th><th>FP / negatives</th></tr></thead>
          <tbody>{(['conservative', 'hybrid'] as const).flatMap(algorithm =>
            (['raw', 'stable'] as const).flatMap(stage => (['OPEN', 'FIST'] as const).map(pose => {
              const counts = report[algorithm][stage][pose]
              return <tr key={`${algorithm}-${stage}-${pose}`}><td>{algorithm} {stage}</td><td>{pose}</td>
                <td>{counts.fn} / {counts.positives} ({rate(counts.falseNegativeRate)})</td>
                <td>{counts.fp} / {counts.negatives} ({rate(counts.falsePositiveRate)})</td></tr>
            })))}</tbody>
        </table>
        {(['conservative', 'hybrid'] as const).map(algorithm => <div key={algorithm}>
          <strong>{algorithm}</strong>: compute median {ms(report[algorithm].compute.medianMs)}, p95 {ms(report[algorithm].compute.p95Ms)}
          {(['raw', 'stable'] as const).map(stage => <p key={stage}>{stage}: marker-to-match median {ms(report[algorithm][stage].latency.medianMs)}, p95 {ms(report[algorithm][stage].latency.p95Ms)}; never recognized {report[algorithm][stage].latency.unrecognized} / {report[algorithm][stage].latency.segments} positive segments.</p>)}
        </div>)}
        <p>Inference per hand observation: median {ms(report.inference.medianMs)}, p95 {ms(report.inference.p95Ms)}. {!session.singleCapture && 'Two labeled hands share each frame’s inference time.'}</p>
        <p>Latency uses {session.singleCapture ? 'the scheduled end of preparation' : 'your manual label/start marker'}, not physical motion onset. Unrecognized segments remain censored. JSON includes raw/stable confusion counts per truth label and source metadata.</p>
      </>}
    </aside>
  )
}
