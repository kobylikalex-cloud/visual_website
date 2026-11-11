import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { InferenceWorkerMessage, WorkerInput } from '../src/tracking/protocol.ts'

// Execute the actual camera lifecycle/scheduling source with hardware replaced.
// Replace only its JSX return with access to the internal event entry points;
// the frame gate, worker handlers, publication, and cleanup are real code.
function cameraHarness() {
  const refs: { current: unknown }[] = []
  const sent: Extract<WorkerInput, {type:'frame'}>[] = []
  const raf: (() => void)[] = []
  let now = 0
  const workers: MockWorker[] = []
  const doc = {hidden:false}
  class MockWorker {
    onmessage: ((event: {data:InferenceWorkerMessage}) => void) | null = null
    constructor() { workers.push(this) }
    postMessage(message: WorkerInput) {
      if(message.type==='init') queueMicrotask(()=>this.onmessage?.({data:{type:'ready',backend:'GPU',benchmarking:false}}))
      else sent.push(message)
    }
    terminate() {}
  }
  const require = createRequire(new URL('../src/components/CameraManager.tsx', import.meta.url))
  const original = readFileSync(new URL('../src/components/CameraManager.tsx', import.meta.url),'utf8')
  const jsxStart = original.search(/ {2}return \(\r?\n {4}<section/)
  assert.ok(jsxStart>0,'locate the UI boundary without replacing lifecycle code')
  const source = original.slice(0,jsxStart) + '\nreturn {startInferenceWorker,processFrame,releaseResources}\n}'
  const compiled = ts.transpileModule(source.replaceAll('import.meta.url',JSON.stringify(import.meta.url)),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023},
  }).outputText
  const exports: {default?: (props: object)=>{startInferenceWorker:(id:number)=>Promise<boolean>;processFrame:()=>void;releaseResources:()=>void}} = {}
  runInNewContext(compiled,{exports,URL,console,queueMicrotask,Worker:MockWorker,document:doc,
    HTMLMediaElement:{HAVE_CURRENT_DATA:2},performance:{now:()=>now},
    requestAnimationFrame:(callback:()=>void)=>{raf.push(callback);return raf.length},cancelAnimationFrame:()=>{},
    createImageBitmap:async()=>({close(){}}),window:{setTimeout,clearTimeout},require(name:string){
      if(name==='react')return {useRef:(value:unknown)=>{const ref={current:value};refs.push(ref);return ref},
        useState:(value:unknown)=>[typeof value==='function'?value():value,()=>{}],useEffect:()=>{},useCallback:(callback:unknown)=>callback}
      if(name==='@mediapipe/tasks-vision')return {}
      if(name==='./DebugEvaluationPanel')return {}
      return require(name+'.ts')
    },
  })
  const camera=exports.default!({})
  refs[0].current={readyState:2,requestVideoFrameCallback(){},cancelVideoFrameCallback(){},pause(){},videoWidth:640,videoHeight:480}
  refs[1].current={getContext:()=>null}
  return {camera,sent,raf,doc,
    async initialize(){await camera.startInferenceWorker(0)},
    frame(serial:number,time:number){now=time;refs[13].current=serial},
    async flush(){await Promise.resolve();await Promise.resolve()},
    complete(){const last=sent.at(-1)!;workers.at(-1)!.onmessage?.({data:{type:'result',token:last.token,timestampMs:last.timestampMs,inferenceMs:45,landmarks:[],worldLandmarks:[],handedness:[]}})},
  }
}

test('worker completion immediately captures the newest image without waiting for RAF or queuing old images',async()=>{
  const h=cameraHarness();await h.initialize()
  h.frame(1,0);h.camera.processFrame();await h.flush()
  assert.equal(h.sent.length,1)
  h.frame(2,34);h.camera.processFrame();await h.flush()
  assert.equal(h.sent.length,1,'one bitmap/inference in flight')
  h.frame(3,45);h.complete();await h.flush()
  assert.equal(h.sent.length,2,'fresh image starts at completion rather than the next display tick')
  assert.equal(h.sent[1].timestampMs,45)
  h.frame(3,90);h.complete();await h.flush()
  assert.equal(h.sent.length,2,'no repeated inference on a submitted image')
  h.camera.releaseResources()
})

test('completion cannot wake hidden or stopped camera sessions',async()=>{
  const h=cameraHarness();await h.initialize()
  h.frame(1,0);h.camera.processFrame();await h.flush()
  h.doc.hidden=true;h.frame(2,45);h.complete();await h.flush()
  assert.equal(h.sent.length,1)
  h.doc.hidden=false;h.camera.releaseResources();h.frame(3,90);h.complete();await h.flush()
  assert.equal(h.sent.length,1)
})
