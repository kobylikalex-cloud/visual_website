import { useState } from 'react'
import { LocalEvaluation, summarizeEvaluation, TRUTH_LABELS, type HandLabel, type TruthLabel } from '../evaluation/LocalEvaluation'
import { RecognitionComparison, type ComparisonRow } from '../evaluation/RecognitionComparison'
import { getFingerPoseEvidence } from '../control/FingerPoseEvidence'
import { recognizeControlHand } from '../control/ControlRecognition'

type Props = {
  rows: ComparisonRow[]
  session: LocalEvaluation
  comparison: RecognitionComparison
  cameraActive: boolean
  onEvaluationStart?: () => void
}

function rate(value: number | null): string { return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%` }
function ms(value: number | null): string { return value === null ? 'n/a' : `${value.toFixed(1)} ms` }

/** Mounted exclusively inside explicit debug mode. This panel has no action dispatch. */
export default function DebugEvaluationPanel({ rows, session, comparison, cameraActive, onEvaluationStart }: Props) {
  const [report, setReport] = useState<ReturnType<typeof summarizeEvaluation> | null>(null)
  const [, refresh] = useState(0)
  const labels = { Left: session.getLabel('Left') ?? '', Right: session.getLabel('Right') ?? '' }

  function handleLabelChange(hand: HandLabel, value: TruthLabel | '', nowMs: number) {
    session.setLabel(hand, value || null, nowMs)
    refresh(previous => previous + 1)
  }

  function stop() {
    session.stop()
    setReport(summarizeEvaluation(session.samples))
    refresh(value => value + 1)
  }

  function download() {
    const summary = summarizeEvaluation(session.samples)
    const blob = new Blob([JSON.stringify({
      schemaVersion: 1, source: __GESTURE_BUILD__, exportedAt: new Date().toISOString(),
      classifiers: { conservative: '99131fc', hybrid: 'a54a49e', sharedConfirmationMs: 150 },
      latencyDefinition: 'manual label marker to first matching analyzed result; positive-pose segments only; not physical motion latency',
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
      <p>Source at server/build start: {__GESTURE_BUILD__.branch} · {__GESTURE_BUILD__.commit.slice(0, 7)}{__GESTURE_BUILD__.dirty ? ' + modified worktree' : ''}</p>
      <p>A/B baselines are observational only. Controls use validated PIP/reach recognition; both A/B baselines use the same landmarks and 150 ms confirmation. Recording pauses gesture actions.</p>
      <table style={{ width: '100%', margin: '12px 0', textAlign: 'left' }}>
        <caption>A = conservative 99131fc · B = historical hybrid a54a49e</caption>
        <thead><tr><th>MediaPipe label</th><th>A raw / stable</th><th>B raw / stable</th><th>Control raw</th><th>A / B compute</th></tr></thead>
        <tbody>{rows.length === 0
          ? <tr><td colSpan={5}>No current hand observations</td></tr>
          : rows.map((row, index) => <tr key={`${row.label}-${index}`}>
            <td>{row.label}{row.identityReliable ? '' : ' (ambiguous)'}</td>
            <td>{row.conservative.raw} / {row.conservative.stable}</td>
            <td>{row.hybrid.raw} / {row.hybrid.stable}</td>
            <td>{recognizeControlHand(row.landmarks).pose}</td>
            <td>{ms(row.conservative.computeMs)} / {ms(row.hybrid.computeMs)}</td>
          </tr>)}</tbody>
      </table>
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
          setReport(null)
          refresh(value => value + 1)
        }}>Start new labeled session</button>
        <button disabled={!session.recording} onClick={stop}>Stop labeling</button>
        <button onClick={() => setReport(summarizeEvaluation(session.samples))}>Refresh measurements</button>
        <button disabled={session.samples.length === 0} onClick={download}>Download local JSON</button>
        <button onClick={() => { session.clear(); setReport(null); refresh(value => value + 1) }}>Clear local samples</button>
      </div>
      <p role="status">{session.recording ? 'Recording locally' : 'Not recording'} · {session.samples.length} labeled observations{!session.recording && session.samples.length >= 9999 ? ' · sample limit reached' : ''}</p>
      {report && <>
        <p>Summary snapshot: {report.samples} observations · {report.missingOrAmbiguous} missing/ambiguous. A missing labeled hand is UNKNOWN and counts as a false negative for OPEN/FIST.</p>
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
        <p>Inference per hand observation: median {ms(report.inference.medianMs)}, p95 {ms(report.inference.p95Ms)}. Two labeled hands share each frame’s inference time.</p>
        <p>Latency uses your manual label/start marker, not physical motion onset. Unrecognized segments remain censored. JSON includes raw/stable confusion counts per truth label and source metadata.</p>
      </>}
    </aside>
  )
}
