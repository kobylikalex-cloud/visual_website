import { FilesetResolver, GestureRecognizer, HandLandmarker, type GestureRecognizerResult, type HandLandmarkerResult } from '@mediapipe/tasks-vision'
import { distribution } from '../tracking/TrackingPerformance'
import type { BenchmarkReport, Delegate, InferenceWorkerMessage, WorkerInput } from '../tracking/protocol'

const scope = self as unknown as { onmessage: (event: MessageEvent<WorkerInput>) => void; postMessage(data: InferenceWorkerMessage): void }
const detectors = new Map<Delegate, HandLandmarker | GestureRecognizer>()
const samples: Record<Delegate, number[]> = { CPU: [], GPU: [] }
const unavailable: string[] = []
let backend: Delegate = 'CPU'
let benchmark = false
let observations = 0
let lastTimestamp = -1
let report: BenchmarkReport | undefined

async function init(mode: Extract<WorkerInput, { type: 'init' }>['mode'], recognitionModel: Extract<WorkerInput, { type: 'init' }>['recognitionModel'] = 'landmarks') {
  // Module WASM exports ModuleFactory when dynamically imported by a module worker.
  // Absolute same-origin URLs avoid Vite treating public WASM scripts as source
  // imports and appending ?import (which fails in the development server).
  const vision = await FilesetResolver.forVisionTasks(new URL('/mediapipe', self.location.origin).href, true)
  const delegates: Delegate[] = mode === 'COMPARE' || mode === 'AUTO' ? ['GPU', 'CPU'] : [mode]
  for (const delegate of delegates) {
    try {
      // Each graph consumes and clears ModuleFactory. A separate module URL per
      // delegate ensures the SDK loader runs again rather than using its cache.
      const fileset = { ...vision, wasmLoaderPath: `${vision.wasmLoaderPath}?delegate=${delegate}` }
      const options = {
        baseOptions: { modelAssetPath: recognitionModel === 'learned' ? '/models/gesture_recognizer.task' : '/models/hand_landmarker.task', delegate },
        canvas: new OffscreenCanvas(640, 480), runningMode: 'VIDEO' as const, numHands: 2,
        minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
      }
      // The recognizer includes its own landmark graph. Use its geometry for
      // same-frame comparisons instead of running a second landmark detector.
      const detector = recognitionModel === 'learned'
        ? await GestureRecognizer.createFromOptions(fileset, options)
        : await HandLandmarker.createFromOptions(fileset, options)
      detectors.set(delegate, detector)
      if (mode !== 'COMPARE') break
    } catch (error) { unavailable.push(`${delegate}: ${String(error)}`) }
  }
  if (!detectors.size) throw new Error(unavailable.join('; '))
  backend = detectors.has('GPU') ? 'GPU' : 'CPU'
  benchmark = mode === 'COMPARE'
  scope.postMessage({ type: 'ready', backend, benchmarking: benchmark })
}

scope.onmessage = event => {
  const message = event.data
  if (message.type === 'init') { void init(message.mode, message.recognitionModel).catch(error => scope.postMessage({ type: 'error', message: String(error) })); return }
  const { bitmap, timestampMs, token } = message
  try {
    if (!detectors.size || !Number.isFinite(timestampMs) || timestampMs <= lastTimestamp) { scope.postMessage({ type: 'skipped', timestampMs, token }); return }
    lastTimestamp = timestampMs
    let result: HandLandmarkerResult | GestureRecognizerResult | undefined
    let inferenceMs = 0
    // Same bitmap and timestamp, alternating order, five warmups and twenty pairs.
    const order = benchmark ? [...detectors.keys()] : [backend]
    if (observations % 2) order.reverse()
    for (const delegate of order) {
      const started = performance.now()
      const detector = detectors.get(delegate)!
      const next = 'recognizeForVideo' in detector
        ? detector.recognizeForVideo(bitmap, timestampMs)
        : detector.detectForVideo(bitmap, timestampMs)
      const elapsed = performance.now() - started
      if (benchmark && observations >= 5) samples[delegate].push(elapsed)
      if (delegate === backend) { result = next; inferenceMs = elapsed }
    }
    observations++
    if (benchmark && observations >= 25) {
      report = { samples: observations - 5, CPU: samples.CPU.length ? distribution(samples.CPU) : null, GPU: samples.GPU.length ? distribution(samples.GPU) : null, unavailable }
      backend = [...detectors.keys()].sort((a, b) => (distribution(samples[a]).p95 ?? Infinity) - (distribution(samples[b]).p95 ?? Infinity))[0]
      for (const [delegate, detector] of detectors) if (delegate !== backend) { detector.close(); detectors.delete(delegate) }
      benchmark = false
      scope.postMessage({ type: 'ready', backend, benchmarking: false })
    }
    if (result) scope.postMessage({ type: 'result', token, timestampMs, inferenceMs, benchmark: report,
      landmarks: result.landmarks.map(hand => hand.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 }))),
      worldLandmarks: result.worldLandmarks.map(hand => hand.map(p => ({ x: p.x, y: p.y, z: p.z }))),
      handedness: result.handedness.map(hand => hand.map(c => ({ categoryName: c.categoryName }))),
      ...('gestures' in result ? { learnedGestures: result.gestures.map(hand => hand.map(c => ({ categoryName: c.categoryName, score: c.score }))) } : {}),
    })
  } catch (error) { scope.postMessage({ type: 'error', message: String(error) }) }
  finally { bitmap.close() }
}
