import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { distribution } from '../src/tracking/TrackingPerformance.ts'
import type { InferenceWorkerMessage, WorkerInput } from '../src/tracking/protocol.ts'

// Exercise the worker message boundary without starting WASM, GPU, or a camera.
// Only MediaPipe inference is replaced; routing, timing, serialization, and
// resource cleanup execute the real worker source.
function workerHarness(failInference = false) {
  const messages: InferenceWorkerMessage[] = []
  const created: { task: string; delegate: string; model: string; closed: boolean }[] = []
  const calls: { task: string; timestamp: number }[] = []
  const categories = [[{ categoryName: 'None', score: .6 }, { categoryName: 'Open_Palm', score: .3 }],
    [{ categoryName: 'Closed_Fist', score: .9 }]]
  const geometry = { landmarks: [[{ x: .1, y: .2, z: .3 }]], worldLandmarks: [[{ x: 1, y: 2, z: 3 }]],
    handedness: [[{ categoryName: 'Left', score: .9, displayName: 'Left', index: 0 }]],
    handednesses: [[{ categoryName: 'Left', score: .9, displayName: 'Left', index: 0 }]] }
  const factory = (task: string) => ({
    createFromOptions: async (_fileset: unknown, options: { baseOptions: { delegate: string; modelAssetPath: string } }) => {
      const record = { task, delegate: options.baseOptions.delegate, model: options.baseOptions.modelAssetPath, closed: false }
      created.push(record)
      const infer = (_bitmap: ImageBitmap, timestamp: number) => {
        calls.push({ task, timestamp })
        if (failInference) throw new Error('inference failed')
        return task === 'learned' ? { ...geometry, gestures: categories } : geometry
      }
      const cleanup = { close() { record.closed = true } }
      return task === 'learned' ? { ...cleanup, recognizeForVideo: infer } : { ...cleanup, detectForVideo: infer }
    },
  })
  let time = 0
  let finishInit: (() => void) | undefined
  const scope = { location: { origin: 'http://localhost' }, onmessage: (event: { data: WorkerInput }) => { void event },
    postMessage(message: InferenceWorkerMessage) {
      messages.push(structuredClone(message))
      if (message.type === 'ready' || message.type === 'error') finishInit?.()
    } }
  const source = readFileSync(new URL('../src/workers/handTracking.worker.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText
  runInNewContext(compiled, { exports: {}, self: scope, URL, performance: { now: () => ++time },
    OffscreenCanvas: class {}, require(name: string) {
      if (name === '@mediapipe/tasks-vision') return { FilesetResolver: { forVisionTasks: async () => ({ wasmLoaderPath: '/wasm.js' }) },
        HandLandmarker: factory('landmarks'), GestureRecognizer: factory('learned') }
      if (name === '../tracking/TrackingPerformance') return { distribution }
      throw new Error(`Unexpected import: ${name}`)
    } })
  return { messages, created, calls,
    async initialize(input: Extract<WorkerInput, { type: 'init' }>) {
      await new Promise<void>(resolve => { finishInit = resolve; scope.onmessage({ data: input }) })
      finishInit = undefined
    },
    frame(timestampMs: number) {
      let closed = false
      const bitmap = { close() { closed = true } } as ImageBitmap
      scope.onmessage({ data: { type: 'frame', bitmap, timestampMs, token: timestampMs } })
      assert.equal(closed, true, 'every transferred bitmap must be closed')
    },
  }
}

test('omitting the recognition model keeps baseline geometry and excludes learned output', async () => {
  const worker = workerHarness()
  await worker.initialize({ type: 'init', mode: 'GPU' })
  worker.frame(1)
  const result = worker.messages.find(message => message.type === 'result')
  assert.ok(result)
  assert.deepEqual(worker.created.map(item => [item.task, item.model]), [['landmarks', '/models/hand_landmarker.task']])
  assert.deepEqual(result.landmarks, [[{ x: .1, y: .2, z: .3, visibility: 1 }]])
  assert.equal('learnedGestures' in result, false)
})

test('learned opt-in returns provided categories including None without a second landmark graph', async () => {
  const worker = workerHarness()
  await worker.initialize({ type: 'init', mode: 'GPU', recognitionModel: 'learned' })
  worker.frame(1)
  const result = worker.messages.find(message => message.type === 'result')
  assert.ok(result)
  assert.deepEqual(worker.created.map(item => [item.task, item.model]), [['learned', '/models/gesture_recognizer.task']])
  assert.deepEqual(result.learnedGestures, [[{ categoryName: 'None', score: .6 }, { categoryName: 'Open_Palm', score: .3 }],
    [{ categoryName: 'Closed_Fist', score: .9 }]])
  assert.deepEqual(worker.calls, [{ task: 'learned', timestamp: 1 }])
})

test('learned benchmarking closes the unused graph and rejects duplicate timestamps', async () => {
  const worker = workerHarness()
  await worker.initialize({ type: 'init', mode: 'COMPARE', recognitionModel: 'learned' })
  for (let timestamp = 1; timestamp <= 25; timestamp++) worker.frame(timestamp)
  assert.equal(worker.created.length, 2)
  assert.ok(worker.created.every(item => item.task === 'learned'))
  assert.equal(worker.created.filter(item => item.closed).length, 1)
  const last = worker.messages.at(-1)
  assert.ok(last?.type === 'result')
  assert.equal(last.benchmark?.samples, 20)
  assert.equal(worker.calls.length, 50)
  worker.frame(25)
  assert.equal(worker.messages.at(-1)?.type, 'skipped')
  assert.equal(worker.calls.length, 50)
  worker.frame(26)
  assert.equal(worker.calls.length, 51)
})

test('learned inference errors report the failure and still release the bitmap', async () => {
  const worker = workerHarness(true)
  await worker.initialize({ type: 'init', mode: 'GPU', recognitionModel: 'learned' })
  worker.frame(1)
  const message = worker.messages.at(-1)
  assert.ok(message?.type === 'error')
  assert.match(message.message, /inference failed/)
  assert.equal(worker.messages.some(item => item.type === 'result'), false)
})
