import test from 'node:test'
import assert from 'node:assert/strict'
import { RecognitionComparison } from '../src/evaluation/RecognitionComparison.ts'
import { LocalEvaluation, summarizeEvaluation } from '../src/evaluation/LocalEvaluation.ts'
import { controlHand } from './fixtures/controlHand.ts'

test('learned comparison preserves paired categories and copies them into labeled local observations',()=>{
  const categories=[{categoryName:'Open_Palm',score:.91}], c=new RecognitionComparison(), s=new LocalEvaluation()
  const rows=c.update([{label:'Left',landmarks:controlHand().worldLandmarks,learnedGestures:categories}],3000)
  s.startSingle('OPEN_FLAT',0); s.record(rows,3050,45,3000,'learned')
  categories[0].score=.1; rows[0].learnedGestures![0].score=.2
  assert.equal(s.samples[0].recognitionModel,'learned')
  assert.equal(s.samples[0].learnedGestures![0].score,.91)
})
test('learned metrics count missing hands and None as unknown, wrong known classes as both FP and FN',()=>{
  const s=new LocalEvaluation(),c=new RecognitionComparison()
  s.startSingle('FIST',0)
  const row=(name:string,t:number)=>c.update([{label:'Left',landmarks:controlHand().worldLandmarks,learnedGestures:[{categoryName:name,score:.9}]}],t)
  s.record([],3050,40,3000,'learned')
  s.record(row('None',3100),3150,40,3100,'learned')
  s.record(row('Open_Palm',3200),3250,40,3200,'learned')
  s.record(row('Closed_Fist',3300),3350,40,3300,'learned')
  const r=summarizeEvaluation(s.samples).learned!
  assert.equal(r.samples,4);assert.equal(r.missingOrAmbiguous,1)
  assert.equal(r.raw.FIST.fn,3);assert.equal(r.raw.FIST.tp,1);assert.equal(r.raw.OPEN.fp,1)
  assert.equal(r.raw.unknown,2);assert.equal(r.raw.latency.medianMs,350)
})
test('baseline cohorts cannot borrow learned results or create uncensored learned latency',()=>{
  const s=new LocalEvaluation(),c=new RecognitionComparison()
  s.startSingle('OPEN_UPRIGHT',0)
  const rows=c.update([{label:'Left',landmarks:controlHand().worldLandmarks,learnedGestures:[{categoryName:'Victory',score:.99}]}],3000)
  s.record(rows,3050,40,3000,'learned')
  s.record(rows,3150,40,3100,'landmarks')
  const r=summarizeEvaluation(s.samples)
  assert.equal(r.learned!.samples,1);assert.equal(r.learned!.raw.OPEN.fn,1)
  assert.equal(r.learned!.raw.latency.unrecognized,1);assert.equal(r.learned!.raw.latency.medianMs,null)
  assert.equal(r.samples,2)
})
