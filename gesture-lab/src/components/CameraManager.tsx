
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import DebugEvaluationPanel from './DebugEvaluationPanel'
import { RecognitionComparison, type ComparisonRow } from '../evaluation/RecognitionComparison'
import { LocalEvaluation } from '../evaluation/LocalEvaluation'
import type { TrackingFrame } from '../control/types'
import { FrameGate, TrackingPerformance, type PerformanceReport } from '../tracking/TrackingPerformance'
import type { BackendMode, BenchmarkReport, InferenceWorkerMessage, ResultGeometry } from '../tracking/protocol'
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
const TRACKING_INTERVAL_MS = 33 // target up to ~30 observations/s when device allows

type CameraManagerProps = {
  pointerStatus?: ReactNode
  onFrame?: (frame: TrackingFrame) => void
  onInactive?: () => void
  onDebugChange?: (enabled: boolean) => void
  onPerformance?: (report: PerformanceReport, backend: string, benchmark: BenchmarkReport | null) => void
}

export default function CameraManager({ onFrame, onInactive, onDebugChange, onPerformance, pointerStatus }: CameraManagerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<HandLandmarker | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const gateRef = useRef(new FrameGate())
  const metricsRef = useRef(new TrackingPerformance())
  const benchmarkingRef = useRef(false)
  const benchmarkRef = useRef<BenchmarkReport | null>(null)
  const backendRef = useRef('Not initialized')
  const lastPerfPublishRef = useRef(0)
  const videoCallbackRef = useRef<number | null>(null)
  const videoSerialRef = useRef(0)
  const workerStartupRef = useRef<(() => void) | null>(null)
  const animationRef = useRef<number | null>(null)

  const sessionRef = useRef(0)
  const performanceWindowRef = useRef({ startedAt: 0, frames: 0, inferenceMs: 0 })
  const debugRef = useRef(false)
  const lastDebugUiRef = useRef(0)
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
  const [detectorBackend, setDetectorBackend] = useState('CPU / main thread')
  const [backendMode, setBackendMode] = useState<BackendMode>('AUTO')
  const [performanceStats, setPerformanceStats] = useState<{ framesPerSecond: number; inferenceMs: number } | null>(null)
  const callbacksRef = useRef({ onFrame, onInactive, onDebugChange, onPerformance })

  useEffect(() => {
    callbacksRef.current = { onFrame, onInactive, onDebugChange, onPerformance }
  }, [onFrame, onInactive, onDebugChange, onPerformance])

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return
    const observer = new PerformanceObserver(list => {
      if (streamRef.current) for (const entry of list.getEntries()) metricsRef.current.longTask(entry.duration)
    })
    observer.observe({ type: 'longtask', buffered: false })
    return () => observer.disconnect()
  }, [])

  // Stop camera, inference loop and MediaPipe resources.
  const releaseResources = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }

    workerStartupRef.current?.()
    workerStartupRef.current = null
    workerRef.current?.terminate()
    workerRef.current = null
    gateRef.current.reset()
    benchmarkingRef.current = false
    videoSerialRef.current = 0
    detectorRef.current?.close()
    detectorRef.current = null

    if (videoRef.current) {
      if (videoCallbackRef.current !== null) videoRef.current.cancelVideoFrameCallback(videoCallbackRef.current)
      videoCallbackRef.current = null
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

    performanceWindowRef.current = { startedAt: 0, frames: 0, inferenceMs: 0 }
    lastDebugUiRef.current = 0
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


  // Shared consumption path for off-thread and legacy/main-thread inference.
  function publishResult(result: ResultGeometry, now: number, inferenceMs: number) {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const publicationStart = performance.now()
    if (publicationStart - now > 200) {
      metricsRef.current.result(inferenceMs, 0, publicationStart - now)
      metricsRef.current.drop('stale')
      callbacksRef.current.onInactive?.()
      return
    }
        // Aggregate one-second performance samples; avoids per-frame React updates.
        const perfWindow = performanceWindowRef.current
        if (perfWindow.startedAt === 0) perfWindow.startedAt = now
        perfWindow.frames++
        perfWindow.inferenceMs += inferenceMs
        if (now - perfWindow.startedAt >= 1000) {
          if (debugRef.current) setPerformanceStats({
            framesPerSecond: Math.round(perfWindow.frames * 1000 / (now - perfWindow.startedAt)),
            inferenceMs: Math.round((perfWindow.inferenceMs / perfWindow.frames) * 10) / 10,
          })
          performanceWindowRef.current = { startedAt: now, frames: 0, inferenceMs: 0 }
        }
        
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
          const rows = comparison.update(result.worldLandmarks.map((landmarks, index) => ({
            label: result.handedness[index]?.[0]?.categoryName ?? 'Unlabeled', landmarks,
          })), now)
          // Evaluation still records EVERY inference, even with slower UI refresh.
          evaluation.record(rows, performance.now(), inferenceMs)
          if (now - lastDebugUiRef.current >= 200) {
            lastDebugUiRef.current = now
            setOrientationMetrics(readings)
            setFingerReadings(result.worldLandmarks.map(getFingerExtensionReadings))
            setComparisonRows(rows)
          }
        }

        const handCount = result.landmarks.length
        setDetectedHands(previous =>
          previous === handCount ? previous : handCount
        )

        callbacksRef.current.onFrame?.({
          timestampMs: now,
          evaluationOnly: evaluation.recording || benchmarkingRef.current,
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
    metricsRef.current.result(inferenceMs, performance.now() - publicationStart, performance.now() - now)
  }

  // Keep only one video frame in flight. Drop old frames instead of queuing
  // inference and acting on stale hand positions.
  async function startInferenceWorker(requestId: number): Promise<boolean> {
    if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') return false
    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/handTracking.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      console.warn('Hand tracker worker unavailable', error)
      return false
    }
    return new Promise(resolve => {
      let initialized = false
      let finished = false
      const timeout = window.setTimeout(() => {
        if (!initialized && !finished) {
          finished = true
          worker.terminate()
          console.warn('Hand worker initialization timed out; falling back to main-thread GPU')
          resolve(false)
        }
      }, 20000)
      workerStartupRef.current = () => {
        window.clearTimeout(timeout)
        if (!finished) { finished = true; worker.terminate(); resolve(false) }
      }
      function failed(error: unknown) {
        console.warn('Hand worker failed', error)
        if (!initialized) {
          if (finished) return
          finished = true
          window.clearTimeout(timeout)
          worker.terminate()
          resolve(false)
          return
        }
        if (workerRef.current !== worker || requestId !== sessionRef.current) return
        sessionRef.current++
        releaseResources()
        setStatus('error')
        setError('Hand-Tracking-Worker fehlgeschlagen. Kamera bitte erneut starten.')
      }
      worker.onerror = event => failed(event.message)
      worker.onmessage = (event: MessageEvent<InferenceWorkerMessage>) => {
        const message = event.data
        if (requestId !== sessionRef.current || finished && !initialized) return
        if (message.type === 'ready') {
          benchmarkingRef.current = message.benchmarking
          backendRef.current = message.backend + ' / worker'
          setDetectorBackend(backendRef.current)
          if (initialized) { callbacksRef.current.onInactive?.(); return }
          if (finished) return
          finished = true
          initialized = true
          window.clearTimeout(timeout)
          workerRef.current = worker
          gateRef.current.reset()
          resolve(true)
        } else if (message.type === 'result' || message.type === 'skipped') {
          if (!gateRef.current.finish(message.token)) return
          if (message.type === 'result') {
            if (message.benchmark) benchmarkRef.current = message.benchmark
            publishResult(message, message.timestampMs, message.inferenceMs)
          }
        } else if (message.type === 'error') {
          failed(message.message)
        }
      }
      worker.postMessage({ type: 'init', mode: backendMode })
    })
  }
  // Send the freshest video frame to the inference worker, or use main-thread
  // GPU fallback when workers are unavailable.
  function processFrame() {
    const video = videoRef.current
    const canvas = canvasRef.current
    const detector = detectorRef.current
    if (!video || !canvas || (!detector && !workerRef.current)) return
    const now = performance.now()
    metricsRef.current.render(now)
    if (now - lastPerfPublishRef.current >= 1000) {
      lastPerfPublishRef.current = now
      callbacksRef.current.onPerformance?.(metricsRef.current.report(now), backendRef.current, benchmarkRef.current)
    }
    if (document.hidden) {
      callbacksRef.current.onInactive?.()
      animationRef.current = requestAnimationFrame(processFrame)
      return
    }
    if (gateRef.current.busy && now - gateRef.current.startedAt > (benchmarkingRef.current ? 10000 : 2000)) {
      sessionRef.current++; releaseResources(); setStatus('error'); setError('Tracking timed out. Restart camera.'); return
    }
    const serial = typeof video.requestVideoFrameCallback === 'function' ? videoSerialRef.current : video.currentTime
    const admission = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ? gateRef.current.captureFrame(serial, now, TRACKING_INTERVAL_MS) : { token: null, busy: false }
    if (admission.busy) metricsRef.current.drop('busy')
    if (admission.token !== null) {
      const token = admission.token
      if (workerRef.current) {
        const worker = workerRef.current
        void createImageBitmap(video).then(bitmap => {
          if (workerRef.current !== worker) {
            bitmap.close()
            return
          }
          if (performance.now() - now > 200) { bitmap.close(); gateRef.current.finish(token); metricsRef.current.drop('stale'); return }
          try { worker.postMessage({ type: 'frame', bitmap, timestampMs: now, token }, [bitmap]) }
          catch (error) { bitmap.close(); throw error }
        }).catch(error => {
          console.warn('Video frame transfer failed', error)
          if (gateRef.current.finish(token)) metricsRef.current.drop('transfer')
        })
      } else if (detector) {
        try {
          const started = performance.now()
          const result = detector.detectForVideo(video, now)
          publishResult(result, now, performance.now() - started)
        } catch (error) {
          console.error('Hand tracking failed', error)
          sessionRef.current++
          releaseResources()
          setStatus('error')
          setError('Fehler während der Handerkennung.')
          return
        } finally {
          gateRef.current.finish(token)
        }
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
    setPerformanceStats(null)
    callbacksRef.current.onInactive?.()

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API unavailable')
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
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
      metricsRef.current = new TrackingPerformance()
      metricsRef.current.start(performance.now())
      benchmarkRef.current = null
      setCameraName(stream.getVideoTracks()[0]?.label || 'Laptop camera')
      video.srcObject = stream

      await video.play()

      if (requestId !== sessionRef.current) return
      if (typeof video.requestVideoFrameCallback === 'function') {
        const countFrame: VideoFrameRequestCallback = (_now, metadata) => {
          if (requestId !== sessionRef.current) return
          metricsRef.current.camera(metadata.presentedFrames)
          videoSerialRef.current = metadata.presentedFrames
          videoCallbackRef.current = video.requestVideoFrameCallback(countFrame)
        }
        videoCallbackRef.current = video.requestVideoFrameCallback(countFrame)
      }

      setLoadingMessage('MediaPipe wird geladen...')

      const workerStarted = await startInferenceWorker(requestId)
      if (requestId !== sessionRef.current) return
      if (!workerStarted) {
        if (backendMode === 'COMPARE') throw new Error('CPU/GPU comparison requires a supported worker. No benchmark was run.')
        setLoadingMessage('GPU-Beschleunigung auf Hauptthread wird initialisiert…')
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
        if (requestId !== sessionRef.current) return
        const options = {
          runningMode: 'VIDEO' as const,
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }
        let detector: HandLandmarker
        let backend = 'GPU / main thread (fallback)'
        try {
          if (backendMode === 'CPU') throw new Error('CPU explicitly selected')
          detector = await HandLandmarker.createFromOptions(vision, {
            ...options,
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          })
        } catch (gpuError) {
          if (backendMode === 'GPU') throw gpuError
          console.warn('GPU main-thread detection unavailable', gpuError)
          backend = 'CPU / main thread'
          detector = await HandLandmarker.createFromOptions(vision, {
            ...options,
            baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
          })
        }
        if (requestId !== sessionRef.current) {
          detector.close()
          return
        }
        setDetectorBackend(backend)
        backendRef.current = backend
        detectorRef.current = detector
      }

      setStatus('active')
      setLoadingMessage('')
      metricsRef.current = new TrackingPerformance()
      metricsRef.current.start(performance.now())

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
    setPerformanceStats(null)
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
              objectFit: 'contain',
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
              objectFit: 'contain',
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
          {pointerStatus ?? 'Gesture Lab · local camera preview'}
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

      {debugEnabled && <label>Inference backend (restart camera to apply)
        <select aria-label="Inference backend" value={backendMode} disabled={status === 'active' || status === 'loading'} onChange={event => setBackendMode(event.target.value as BackendMode)}>
          <option value="AUTO">Worker auto (GPU if available; unbenchmarked)</option>
          <option value="COMPARE">Compare CPU/GPU on identical frames (highlight paused)</option>
          <option value="CPU">CPU worker</option><option value="GPU">GPU worker</option>
        </select>
        <small>{detectorBackend}</small>
      </label>}

      {status === 'active' && <p className="camera-source">{cameraName} · local processing</p>}

      {debugEnabled && <details><summary>Historical A/B, finger readings and local labeling</summary>        {/* Debug-only pose classifications */}
        {debugEnabled && status === 'active' && (
            <div style={{
                position: 'relative',
                top: 0,
                left: 0,
                background: '#080d17cc',
                color: '#fff',
                padding: '12px 16px',
                borderRadius: 8,
                fontSize: 14,
                textAlign: 'left'
            }}>
                <div style={{ fontSize: 12, marginBottom: 7, color: '#93c5fd' }}>
                  {performanceStats
                    ? `Backend: ${detectorBackend} · Tracking: ${performanceStats.framesPerSecond} Frames/s · MediaPipe: ${performanceStats.inferenceMs} ms/Frame`
                    : `Backend: ${detectorBackend} · Tracking-Performance wird gemessen…`}
                </div>
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
<DebugEvaluationPanel
        rows={comparisonRows}
        session={evaluation}
        comparison={comparison}
        cameraActive={status === 'active'}
        onEvaluationStart={() => callbacksRef.current.onInactive?.()}
      /></details>}

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
