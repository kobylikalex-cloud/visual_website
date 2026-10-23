
import { useCallback, useEffect, useRef, useState } from 'react'
import DebugEvaluationPanel from './DebugEvaluationPanel'
import { RecognitionComparison, type ComparisonRow } from '../evaluation/RecognitionComparison'
import { LocalEvaluation } from '../evaluation/LocalEvaluation'
import type { TrackingFrame } from '../control/types'
import {
  DrawingUtils,
  FilesetResolver,
  HandLandmarker
} from '@mediapipe/tasks-vision'

import { classifyHandPose, HandPoseStabilizer, type HandPose } from '../gestures/HandPoseEngine'
import {
  classifyHandOrientation,
  getHandOrientationMetrics,
  HandOrientationStabilizer,
  type HandOrientation,
  type HandOrientationMetrics
} from '../gestures/HandOrientationDiagnostics'
import {
  getFingerExtensionReadings,
  type FingerExtensionReading
} from '../gestures/FingerExtensionDiagnostics'

type CameraStatus = 'idle' | 'loading' | 'active' | 'error'

const MODEL_PATH = '/models/hand_landmarker.task'
const WASM_PATH = '/mediapipe'
const TRACKING_INTERVAL_MS = 50

type CameraManagerProps = {
  onFrame?: (frame: TrackingFrame) => void
  onInactive?: () => void
  onDebugChange?: (enabled: boolean) => void
}

export default function CameraManager({ onFrame, onInactive, onDebugChange }: CameraManagerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<HandLandmarker | null>(null)
  const animationRef = useRef<number | null>(null)

  const sessionRef = useRef(0)
  const lastVideoTimeRef = useRef(-1)
  const lastDetectionRef = useRef(0)
  const debugRef = useRef(false)
  const poseFiltersRef = useRef(new Map<string, HandPoseStabilizer>())
  const orientationFiltersRef = useRef(new Map<string, HandOrientationStabilizer>())
  const [comparison] = useState(() => new RecognitionComparison())
  const [evaluation] = useState(() => new LocalEvaluation())

  const [status, setStatus] = useState<CameraStatus>('idle')
  const [loadingMessage, setLoadingMessage] = useState('')
  const [error, setError] = useState('')
  const [detectedHands, setDetectedHands] = useState(0)
  const [handPoses, setHandPoses] = useState<HandPose[]>([])
  const [orientationMetrics, setOrientationMetrics] = useState<(HandOrientationMetrics | null)[]>([])
  const [orientations, setOrientations] = useState<HandOrientation[]>([])
  const [fingerReadings, setFingerReadings] = useState<FingerExtensionReading[][]>([])
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([])
  const [cameraName, setCameraName] = useState('Laptop camera')
  const callbacksRef = useRef({ onFrame, onInactive, onDebugChange })

  useEffect(() => {
    callbacksRef.current = { onFrame, onInactive, onDebugChange }
  }, [onFrame, onInactive, onDebugChange])

  // Stop camera, inference loop and MediaPipe resources.
  const releaseResources = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    detectorRef.current?.close()
    detectorRef.current = null

    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }

    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')

    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height)
    }

    lastVideoTimeRef.current = -1
    lastDetectionRef.current = 0
    poseFiltersRef.current.clear()
    orientationFiltersRef.current.clear()
    comparison.reset()
    evaluation.stop()
    callbacksRef.current.onInactive?.()
  }, [comparison, evaluation])

  // Invalidate pending camera startup before releasing resources on unmount.
  const cleanupOnUnmount = useCallback(() => {
    sessionRef.current++
    releaseResources()
  }, [releaseResources])

  useEffect(() => cleanupOnUnmount, [cleanupOnUnmount])

  // Process camera frames.
  function processFrame() {
    const video = videoRef.current
    const canvas = canvasRef.current
    const detector = detectorRef.current

    if (!video || !canvas || !detector) return

    const now = performance.now()

    const newFrame = video.currentTime !== lastVideoTimeRef.current
    const intervalPassed =
      now - lastDetectionRef.current >= TRACKING_INTERVAL_MS

    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      newFrame &&
      intervalPassed
    ) {
      try {
        lastVideoTimeRef.current = video.currentTime
        lastDetectionRef.current = now

        const inferenceStart = performance.now()
        const result = detector.detectForVideo(video, now)
        const inferenceMs = performance.now() - inferenceStart
        
        // Stabilize each hand independently, keyed by MediaPipe handedness.
        // Known poses require confirmation; uncertainty immediately clears pose output.
        const visibleHands = new Set<string>()
        const readings = result.worldLandmarks.map(getHandOrientationMetrics)
        const nextOrientations: HandOrientation[] = []
        const poses = result.worldLandmarks.map((landmarks, index) => {
          const label = result.handedness[index]?.[0]?.categoryName
          const key = label === 'Left' || label === 'Right'
            ? label
            : `index-${index}`

          visibleHands.add(key)

          let filter = poseFiltersRef.current.get(key)
          if (!filter) {
            filter = new HandPoseStabilizer(150)
            poseFiltersRef.current.set(key, filter)
          }

          let orientationFilter = orientationFiltersRef.current.get(key)
          if (!orientationFilter) {
            orientationFilter = new HandOrientationStabilizer(180)
            orientationFiltersRef.current.set(key, orientationFilter)
          }
          nextOrientations.push(
            orientationFilter.update(classifyHandOrientation(readings[index]), now)
          )

          return filter.update(classifyHandPose(landmarks), now)
        })

        for (const key of poseFiltersRef.current.keys()) {
          if (!visibleHands.has(key)) poseFiltersRef.current.delete(key)
        }
        for (const key of orientationFiltersRef.current.keys()) {
          if (!visibleHands.has(key)) orientationFiltersRef.current.delete(key)
        }
        setOrientations(previous =>
          previous.length === nextOrientations.length &&
          previous.every((value, index) => value === nextOrientations[index])
            ? previous
            : nextOrientations
        )

        setHandPoses(previous =>
            previous.length === poses.length &&
            previous.every((pose, index) => pose === poses[index])
                ? previous
                : poses
        )

        // Camera-relative telemetry, shown only in the debug overlay.
        if (debugRef.current) {
          setOrientationMetrics(readings)
          setFingerReadings(result.worldLandmarks.map(getFingerExtensionReadings))
          const rows = comparison.update(result.worldLandmarks.map((landmarks, index) => ({
            label: result.handedness[index]?.[0]?.categoryName ?? 'Unlabeled', landmarks,
          })), now)
          evaluation.record(rows, performance.now(), inferenceMs)
          setComparisonRows(rows)
        }

        const handCount = result.landmarks.length
        setDetectedHands(previous =>
          previous === handCount ? previous : handCount
        )

        callbacksRef.current.onFrame?.({
          timestampMs: now,
          evaluationOnly: evaluation.recording,
          detections: result.landmarks.map((landmarks, index) => ({
            landmarks,
            worldLandmarks: result.worldLandmarks[index] ?? [],
            handedness: result.handedness[index]?.[0]?.categoryName,
          })),
        })

        const context = canvas.getContext('2d')

        if (context) {
          if (
            canvas.width !== video.videoWidth ||
            canvas.height !== video.videoHeight
          ) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
          }

          context.clearRect(0, 0, canvas.width, canvas.height)

          if (debugRef.current) {
            const drawingUtils = new DrawingUtils(context)

            for (const landmarks of result.landmarks) {
              drawingUtils.drawConnectors(
                landmarks,
                HandLandmarker.HAND_CONNECTIONS,
                {
                  color: '#38E8F5',
                  lineWidth: 3
                }
              )

              drawingUtils.drawLandmarks(landmarks, {
                color: '#FFE082',
                radius: 3
              })
            }
          }
        }
      } catch (err) {
        console.error('Hand tracking failed:', err)

        sessionRef.current++
        releaseResources()

        setStatus('error')
        setError('Fehler während der Handerkennung.')
        setDetectedHands(0)
        setHandPoses([])
        setOrientationMetrics([])
        setOrientations([])
        setFingerReadings([])
        setComparisonRows([])
        return
      }
    }

    animationRef.current = requestAnimationFrame(processFrame)
  }

  async function startCamera() {
    if (status === 'loading' || status === 'active') return

    const requestId = ++sessionRef.current

    setStatus('loading')
    setLoadingMessage('Kamera wird gestartet...')
    setError('')
    setDetectedHands(0)
    setHandPoses([])
    setOrientationMetrics([])
    setOrientations([])
    setFingerReadings([])
    setComparisonRows([])
    callbacksRef.current.onInactive?.()

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API unavailable')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      })

      // A previous request may have been cancelled.
      if (requestId !== sessionRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }

      const video = videoRef.current

      if (!video) {
        stream.getTracks().forEach(track => track.stop())
        throw new Error('Video element unavailable')
      }

      streamRef.current = stream
      setCameraName(stream.getVideoTracks()[0]?.label || 'Laptop camera')
      video.srcObject = stream

      await video.play()

      if (requestId !== sessionRef.current) return

      setLoadingMessage('MediaPipe wird geladen...')

      const vision = await FilesetResolver.forVisionTasks(WASM_PATH)

      if (requestId !== sessionRef.current) return

      const detector = await HandLandmarker.createFromOptions(
        vision,
        {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        }
      )

      if (requestId !== sessionRef.current) {
        detector.close()
        return
      }

      detectorRef.current = detector

      setStatus('active')
      setLoadingMessage('')

      animationRef.current = requestAnimationFrame(processFrame)
    } catch (err) {
      if (requestId !== sessionRef.current) return

      console.error('Camera/MediaPipe startup error:', err)

      releaseResources()

      const name = err instanceof DOMException ? err.name : ''

      if (name === 'NotAllowedError') {
        setError('Kamerazugriff wurde verweigert.')
      } else if (name === 'NotFoundError') {
        setError('Keine Kamera gefunden.')
      } else if (name === 'NotReadableError') {
        setError('Die Kamera ist möglicherweise bereits in Verwendung.')
      } else {
        setError(
          'Kamera oder MediaPipe konnte nicht gestartet werden. ' +
          'Prüfe die Browser-Konsole und die Dateien unter public.'
        )
      }

      setStatus('error')
    }
  }

  function stopCamera() {
    sessionRef.current++
    releaseResources()

    setStatus('idle')
    setError('')
    setLoadingMessage('')
    setDetectedHands(0)
    setHandPoses([])
    setOrientationMetrics([])
    setOrientations([])
    setFingerReadings([])
    setComparisonRows([])
  }

  function toggleDebug() {
    const next = !debugEnabled

    debugRef.current = next
    setDebugEnabled(next)
    callbacksRef.current.onDebugChange?.(next)

    if (!next) {
      evaluation.stop()
      comparison.reset()
      setComparisonRows([])
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')

      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }

  return (
    <section className="camera-manager" data-debug={debugEnabled}>
      <div style={{
        display: debugEnabled ? 'block' : 'none',
        background: '#080d17',
        border: '1px solid #334155',
        borderRadius: 16,
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#080d17'
        }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
              opacity: debugEnabled ? 1 : 0
            }}
          />

          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
              opacity: debugEnabled ? 1 : 0,
              pointerEvents: 'none'
            }}
          />

          <div style={{
            position: 'absolute',
            top: 16,
            left: 16,
            color: status === 'active' ? '#5eead4' : '#94a3b8',
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: 2
          }}>
            {status === 'active'
              ? '● TRACKING ACTIVE'
              : '○ TRACKING OFFLINE'}
          </div>

          {status === 'active' && (
            <div style={{
              position: 'absolute',
              bottom: 16,
              left: 16,
              background: '#080d17cc',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 13
            }}>
              Hände erkannt: {detectedHands} / 2
            </div>
          )}
        {/* Debug-only pose classifications */}
        {debugEnabled && status === 'active' && (
            <div style={{
                position: 'absolute',
                top: 48,
                left: 16,
                background: '#080d17cc',
                color: '#fff',
                padding: '12px 16px',
                borderRadius: 8,
                fontSize: 14,
                textAlign: 'left'
            }}>
                {handPoses.length === 0
                ? 'Keine Hand erkannt'
                : handPoses.map((pose, index) => (
                    <div key={index} style={{ marginBottom: 6 }}>
                        Hand {index + 1} (A baseline): <strong>{pose}</strong>
                        <div style={{ fontSize: 12, marginTop: 3 }}>
                          Ausrichtung: <strong>{
                            orientations[index] === 'UPRIGHT_LIKE'
                              ? 'AUFRECHT (Kandidat)'
                              : orientations[index] === 'FLAT_LIKE'
                                ? 'WAAGERECHT (Kandidat)'
                                : 'UNSICHER'
                          }</strong>
                        </div>
                        {orientationMetrics[index] && (
                          <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                            Bildneigung: {orientationMetrics[index].imageTiltDegrees}°
                            {' · '}Tiefe: {orientationMetrics[index].depthTiltDegrees}°
                            <div>
                              Handfläche zur Kamera: {orientationMetrics[index].palmFacingCameraPercent}%
                            </div>
                          </div>
                        )}
                        {(fingerReadings[index]?.length ?? 0) > 0 && (
                          <div style={{
                            marginTop: 6,
                            paddingTop: 5,
                            borderTop: '1px solid #64748b',
                            fontSize: 11,
                            color: '#dbeafe'
                          }}>
                            <div style={{ marginBottom: 3 }}>Finger: PIP / DIP / Streckung</div>
                            {fingerReadings[index].map(reading => (
                              <div key={reading.finger}>
                                {reading.finger}: {reading.pipAngleDegrees}° / {reading.dipAngleDegrees}° / {reading.reachPercent}%
                              </div>
                            ))}
                          </div>
                        )}
                    </div>
                ))
            }
            </div>
        )}
          {!debugEnabled && (
            <div style={{
              position: 'absolute',
              top: '50%',
              width: '100%',
              textAlign: 'center',
              color: '#94a3b8'
            }}>
              Debug visualization disabled
            </div>
          )}
        </div>

        <div style={{
          padding: 18,
          borderTop: '1px solid #334155',
          color: '#94a3b8',
          fontSize: 13
        }}>
          Gesture Lab · Phase 02 · Hand Landmark Tracking
        </div>
      </div>

      <div className="camera-buttons" style={{
        display: 'flex',
        justifyContent: 'center',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: debugEnabled ? 16 : 0
      }}>
        <button
          onClick={startCamera}
          disabled={status === 'loading' || status === 'active'}
        >
          {status === 'loading' ? 'Starting camera…' : 'Start camera'}
        </button>

        <button
          onClick={stopCamera}
          disabled={status === 'idle' || status === 'error'}
        >
          Stop camera
        </button>

        <button onClick={toggleDebug}>
          Debug: {debugEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {status === 'active' && <p className="camera-source">{cameraName} · local processing</p>}

      {debugEnabled && <DebugEvaluationPanel
        rows={comparisonRows}
        session={evaluation}
        comparison={comparison}
        cameraActive={status === 'active'}
        onEvaluationStart={() => callbacksRef.current.onInactive?.()}
      />}

      {status === 'loading' && (
        <p style={{ color: '#38bdf8' }}>
          {loadingMessage}
        </p>
      )}

      {error && (
        <p style={{ color: '#f87171' }}>
          {error}
        </p>
      )}
    </section>
  )
}
