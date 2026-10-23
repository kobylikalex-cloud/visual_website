import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

// MediaPipe detectForVideo is synchronous. Running it here prevents inference
// from blocking rendering, pointer events and React on the browser main thread.
type InitMessage = { type: 'init' }
type FrameMessage = { type: 'frame'; bitmap: ImageBitmap; timestampMs: number }
type Incoming = InitMessage | FrameMessage

let detector: HandLandmarker | null = null
let lastTimestamp = -1
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null
  postMessage(data: unknown): void
}

async function init() {
  if (detector) return
  try {
    const vision = await FilesetResolver.forVisionTasks('/mediapipe')
    const settings = {
      runningMode: 'VIDEO' as const,
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }
    let backend: 'GPU' | 'CPU' = 'GPU'
    try {
      detector = await HandLandmarker.createFromOptions(vision, {
        ...settings,
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
      })
    } catch {
      backend = 'CPU'
      detector = await HandLandmarker.createFromOptions(vision, {
        ...settings,
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' },
      })
    }
    scope.postMessage({ type: 'ready', backend })
  } catch (error) {
    scope.postMessage({ type: 'error', message: String(error) })
  }
}

scope.onmessage = event => {
  const message = event.data
  if (message.type === 'init') {
    void init()
    return
  }
  const { bitmap, timestampMs } = message
  try {
    if (!detector || !Number.isFinite(timestampMs) || timestampMs <= lastTimestamp) {
      scope.postMessage({ type: 'skipped', timestampMs })
      return
    }
    lastTimestamp = timestampMs
    const started = performance.now()
    const result = detector.detectForVideo(bitmap, timestampMs)
    const inferenceMs = performance.now() - started
    // Clone numeric data. No live media and no video frame leave the machine.
    scope.postMessage({
      type: 'result', timestampMs, inferenceMs,
      landmarks: result.landmarks.map(hand => hand.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1 }))),
      worldLandmarks: result.worldLandmarks.map(hand => hand.map(p => ({ x: p.x, y: p.y, z: p.z }))),
      handedness: result.handedness.map(hand => hand.map(c => ({ categoryName: c.categoryName }))),
    })
  } catch (error) {
    scope.postMessage({ type: 'error', message: String(error) })
  } finally {
    bitmap.close()
  }
}
