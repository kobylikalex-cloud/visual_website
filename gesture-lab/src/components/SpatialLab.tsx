import {useCallback,useEffect,useState} from 'react'
import App from '../App'
import {SpatialControlBridge} from '../spatial/SpatialControlBridge'
import type {SpatialSceneController} from '../spatial/SpatialScene'
import SpatialScenePanel from './SpatialScenePanel'
import './spatial-lab.css'

function SpatialContents({bridge}:{bridge:SpatialControlBridge}){
  const [view,setView]=useState(()=>bridge.getDebug())
  const [message,setMessage]=useState('Optional depth calibration: hold one fist comfortably still at each position, then capture. No physical distance is measured.')
  useEffect(()=>{const timer=setInterval(()=>setView(bridge.getDebug()),100);return()=>clearInterval(timer)},[bridge])
  const ready=useCallback((scene:SpatialSceneController|null)=>bridge.connectScene(scene),[bridge])
  const native=useCallback((active:boolean)=>bridge.setNativeActive(active),[bridge])
  const reset=useCallback(()=>bridge.reset(),[bridge])
  function capture(position:'near'|'neutral'|'far'){
    setMessage(bridge.captureCalibration(position)?`${position} captured locally for this session.`:'Keep a complete fist steady with its palm facing the camera. Use distinct near / neutral / far positions, then try again.')
  }
  const snapshot=view.snapshot,calibration=view.calibration
  const number=(value:number|null|undefined)=>value===null||value===undefined?'unavailable':value.toFixed(3)
  return <>
    <div className="spatial-navigation"><a href="/">← Original gesture playground</a><span>SPRINT 04 · LOCAL SPATIAL LAB</span></div>
    <SpatialScenePanel onReady={ready} onNativeInteraction={native} onReset={reset} state={snapshot} debugEnabled={view.enabled}/>
    {view.enabled&&<section className="movement-settings spatial-diagnostics" aria-label="Spatial Interaction Debug">
      <h2>Spatial Interaction Debug</h2>
      <p>State: {snapshot?.state??'Scene unavailable'} · gesture: {view.gesture} · hand ID: {snapshot?.handId??'none'} · selected object: {snapshot?.selectedId??'none'}</p>
      <p>{snapshot?.reason}</p>
      <p>Raw palm (camera normalized): {snapshot?.rawPalm?`${number(snapshot.rawPalm.x)}, ${number(snapshot.rawPalm.y)}`:'unavailable'} · filtered interaction point (screen px): {snapshot?.filteredPalm?`${number(snapshot.filteredPalm.x)}, ${number(snapshot.filteredPalm.y)}`:'unavailable'}</p>
      <p>Projected palm width: {number(view.projectedPalmScale)} px · conditioned palm scale: {number(view.depth.scale)} · relative magnification: {number(view.depth.relative)} · reference scale: {number(view.depth.neutralScale)}</p>
      <p>Depth quality: {view.depth.quality} · {view.depth.reason}. Invalid depth freezes Z; this is a monocular proxy, not centimetres.</p>
      <p>Cube position: X {number(snapshot?.position.x)} · Y {number(snapshot?.position.y)} · Z {number(snapshot?.position.z)} virtual units.</p>
      <p>Tracking: {view.performance?.processedFps.toFixed(1)??'unavailable'} FPS · inference median / p95 {number(view.performance?.inference.median)} / {number(view.performance?.inference.p95)} ms · {view.backend}</p>
      <p>Scene: {number(view.render?.fps)} FPS · render {number(view.render?.renderMs)} ms. Software timing excludes camera exposure and physical display latency.</p>
      <p role="status">{message}</p>
      <div className="spatial-calibration-actions"><button onClick={()=>capture('near')}>Capture near fist</button><button onClick={()=>capture('neutral')}>Capture neutral fist</button><button onClick={()=>capture('far')}>Capture far fist</button></div>
      <p>Near / neutral / far: {number(calibration.nearScale)} / {number(calibration.neutralScale)} / {number(calibration.farScale)} · {calibration.complete?'calibrated':'optional calibration incomplete'}</p>
      <div className="spatial-depth-indicator" aria-label="Relative depth indicator"><span>far</span><meter min="0.5" max="1.5" value={Math.max(.5,Math.min(1.5,view.depth.relative))} aria-label="Relative palm magnification"/><span>near</span></div>
      <button onClick={()=>{
        const blob=new Blob([JSON.stringify({date:new Date().toISOString(),build:__GESTURE_BUILD__,...bridge.getDebug(),note:'Local numeric summary only. No video or hand landmark arrays. No centimetre accuracy claim.'},null,2)],{type:'application/json'})
        const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='gesture-sprint04-spatial-metrics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
      }}>Download local spatial metrics</button>
    </section>}
  </>
}

export default function SpatialLab(){
  const [bridge]=useState(()=>new SpatialControlBridge())
  return <App spatial={bridge} spatialContent={<SpatialContents bridge={bridge}/>}/>
}
