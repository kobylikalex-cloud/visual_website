import test from 'node:test'
import assert from 'node:assert/strict'
import { collectTargets, APP_CLICK_TARGET_IDS } from '../src/control/TargetElements.ts'
import { InteractionTargetRegistry } from '../src/control/InteractionTargetRegistry.ts'

test('only registered eligible app clicks receive focus; unsupported drag and duplicate owners do not',()=>{
  function element(id:string,kind='click',visible=true) {
    const rect={left:100,top:100,width:100,height:80,right:200,bottom:180}
    return {dataset:{gestureTarget:id,gestureKind:kind},isConnected:true,parentElement:null,
      matches:()=>false,closest:()=>null,getClientRects:()=>[rect],getBoundingClientRect:()=>rect,visible}
  }
  const pulse=element('pulse'),unregistered=element('palette'),duplicate=element('pulse'),drag=element('orbit-card','drag'),hidden=element('reset','click',false)
  const prior={document:globalThis.document,style:globalThis.getComputedStyle,width:globalThis.innerWidth,height:globalThis.innerHeight}
  Object.assign(globalThis,{document:{querySelectorAll:()=>[pulse,unregistered,duplicate,drag,hidden]},innerWidth:1000,innerHeight:800,
    getComputedStyle:(e:typeof pulse)=>({display:'block',visibility:'visible',opacity:e.visible?'1':'0'})})
  try {
    const registry=new InteractionTargetRegistry()
    registry.register('pulse',pulse,()=>true,()=>{})
    registry.register('orbit-card',drag,()=>true,()=>{})
    registry.register('reset',hidden,()=>true,()=>{})
    assert.deepEqual(collectTargets(registry).map(t=>t.id),['pulse'])
    assert.deepEqual(collectTargets(registry,'palette'),[])
    assert.ok(APP_CLICK_TARGET_IDS.includes('pulse'));assert.ok(APP_CLICK_TARGET_IDS.includes('palette'));assert.ok(APP_CLICK_TARGET_IDS.includes('reset'))
  } finally {Object.assign(globalThis,{document:prior.document,getComputedStyle:prior.style,innerWidth:prior.width,innerHeight:prior.height})}
})
