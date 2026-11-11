import {useEffect, useId, useRef} from 'react'
import type {KeyboardEvent, PointerEvent} from 'react'
import {SpatialSceneController, translateWithGripOffset} from '../spatial/SpatialScene.ts'
import type {SpatialSnapshot, Vec3} from '../spatial/types.ts'
import './spatial.css'

export type SpatialScenePanelProps = {
  onReady?:(scene:SpatialSceneController|null)=>void
  debugEnabled?:boolean
  state?:SpatialSnapshot|null
  onReset?:()=>void
  onNativeInteraction?:(active:boolean)=>void
}

const labels = {
  IDLE:'Ready to explore', TARGET_FOCUSED:'Cube focused', GRAB_PENDING:'Hold to grasp',
  GRABBING_3D:'Moving in space', RELEASING:'Position held', UNCERTAIN:'Position held',
}

export function SpatialScenePanel({onReady,debugEnabled=false,state=null,onReset,onNativeInteraction}:SpatialScenePanelProps) {
  const canvasRef=useRef<HTMLCanvasElement>(null)
  const sceneRef=useRef<SpatialSceneController|null>(null)
  const positionRef=useRef<HTMLOutputElement>(null)
  const metricsRef=useRef<HTMLOutputElement>(null)
  const errorRef=useRef<HTMLParagraphElement>(null)
  const callbacks=useRef({onReady,onNativeInteraction})
  const feedback=useRef(state)
  const debug=useRef(debugEnabled)
  const drag=useRef<{id:number;z:number;offset:Vec3}|null>(null)
  const instructionId=useId()

  useEffect(()=>{callbacks.current={onReady,onNativeInteraction}},[onReady,onNativeInteraction])
  useEffect(()=>{feedback.current=state; if (!drag.current) sceneRef.current?.setFeedback(state)},[state])
  useEffect(()=>{debug.current=debugEnabled; sceneRef.current?.setDebug(debugEnabled)},[debugEnabled])

  useEffect(()=>{
    const canvas=canvasRef.current
    if (!canvas) return
    let scene:SpatialSceneController
    try { scene=new SpatialSceneController(canvas) }
    catch {
      if (errorRef.current) {
        errorRef.current.textContent='3D rendering is unavailable in this browser. Enable WebGL to explore the scene.'
        errorRef.current.hidden=false
      }
      return
    }
    if (errorRef.current) errorRef.current.hidden=true
    sceneRef.current=scene
    scene.setFeedback(feedback.current)
    scene.setDebug(debug.current)
    callbacks.current.onReady?.(scene)
    let frame=0
    let visible=true
    let stopped=false
    let lastReadout=-Infinity
    const tick=(now:number)=>{
      frame=0
      if (stopped||document.hidden||!visible) return
      scene.render(now)
      if (now-lastReadout>300) {
        const position=scene.getPosition()
        if (positionRef.current) positionRef.current.textContent=`X ${position.x.toFixed(2)}   Y ${position.y.toFixed(2)}   Z ${position.z.toFixed(2)}`
        const metrics=scene.getMetrics()
        if (metricsRef.current) metricsRef.current.textContent=`${metrics.fps.toFixed(0)} fps · ${metrics.renderMs.toFixed(1)} ms render`
        lastReadout=now
      }
      frame=requestAnimationFrame(tick)
    }
    const resume=()=>{
      if (frame) cancelAnimationFrame(frame)
      frame=0
      if (!stopped&&!document.hidden&&visible) frame=requestAnimationFrame(tick)
      if (document.hidden&&drag.current) {
        drag.current=null
        callbacks.current.onNativeInteraction?.(false)
        scene.setFeedback(feedback.current)
      }
    }
    const resize=new ResizeObserver(()=>scene.resize())
    resize.observe(canvas)
    const intersection=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;resume()})
    intersection.observe(canvas)
    document.addEventListener('visibilitychange',resume)
    resume()
    return ()=>{
      stopped=true
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange',resume)
      resize.disconnect()
      intersection.disconnect()
      if (drag.current) callbacks.current.onNativeInteraction?.(false)
      drag.current=null
      callbacks.current.onReady?.(null)
      sceneRef.current=null
      scene.dispose()
    }
  },[])

  function startDrag(event:PointerEvent<HTMLCanvasElement>) {
    if (event.button!==0) return
    const scene=sceneRef.current
    if (!scene?.pick({x:event.clientX,y:event.clientY})) return
    const position=scene.getPosition()
    const plane=scene.planePoint({x:event.clientX,y:event.clientY},position.z)
    if (!plane) return
    event.currentTarget.focus({preventScroll:true})
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current={id:event.pointerId,z:position.z,offset:{x:position.x-plane.x,y:position.y-plane.y,z:0}}
    callbacks.current.onNativeInteraction?.(true)
    scene.setFeedback('GRABBING_3D')
  }

  function movePointer(event:PointerEvent<HTMLCanvasElement>) {
    const scene=sceneRef.current
    if (!scene) return
    const current=drag.current
    if (current?.id===event.pointerId) {
      const point=scene.planePoint({x:event.clientX,y:event.clientY},current.z)
      if (point) scene.setPosition(translateWithGripOffset(point,current.offset,scene.bounds))
    } else if (!current) {
      scene.setNativeHover(Boolean(scene.pick({x:event.clientX,y:event.clientY})))
    }
  }

  function endDrag(event:PointerEvent<HTMLCanvasElement>) {
    if (drag.current?.id!==event.pointerId) return
    drag.current=null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    callbacks.current.onNativeInteraction?.(false)
    sceneRef.current?.setFeedback(feedback.current)
  }

  function keyboardMove(event:KeyboardEvent<HTMLCanvasElement>) {
    const scene=sceneRef.current
    if (!scene) return
    const step=event.shiftKey?.2:.08
    const directions:Record<string,Vec3>={
      ArrowLeft:{x:-step,y:0,z:0},ArrowRight:{x:step,y:0,z:0},
      ArrowUp:{x:0,y:step,z:0},ArrowDown:{x:0,y:-step,z:0},
      PageUp:{x:0,y:0,z:step},PageDown:{x:0,y:0,z:-step},
    }
    const delta=directions[event.key]
    if (!delta) return
    event.preventDefault()
    callbacks.current.onNativeInteraction?.(true)
    const position=scene.getPosition()
    scene.setPosition({x:position.x+delta.x,y:position.y+delta.y,z:position.z+delta.z})
    scene.setFeedback('TARGET_FOCUSED')
  }

  function endKeyboard() {
    if (drag.current) return
    callbacks.current.onNativeInteraction?.(false)
    sceneRef.current?.setFeedback(feedback.current)
  }

  function blurCanvas() {
    const current=drag.current
    drag.current=null
    const canvas=canvasRef.current
    if (current&&canvas?.hasPointerCapture(current.id)) canvas.releasePointerCapture(current.id)
    callbacks.current.onNativeInteraction?.(false)
    sceneRef.current?.setFeedback(feedback.current)
  }

  return <section className="spatial-scene-panel" aria-label="Interactive spatial scene">
    <div className="spatial-scene-heading">
      <span><i aria-hidden="true"/>{labels[state?.state??'IDLE']}</span>
      {onReset&&<button type="button" onClick={onReset}>Reset position <span aria-hidden="true">↺</span></button>}
    </div>
    <div className="spatial-scene-stage">
      <canvas ref={canvasRef} className="spatial-scene-canvas" tabIndex={0} role="img"
        aria-label="A three-dimensional cube. Drag to translate it, or use arrow keys and Page Up or Page Down."
        aria-describedby={instructionId}
        onPointerDown={startDrag} onPointerMove={movePointer} onPointerUp={endDrag}
        onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onPointerLeave={()=>sceneRef.current?.setNativeHover(false)}
        onKeyDown={keyboardMove} onKeyUp={endKeyboard} onBlur={blurCanvas}/>
      <p ref={errorRef} className="spatial-scene-error" role="status" hidden/>
      <span className="spatial-scene-axis" aria-hidden="true">Y ↑<br/>X →<br/><span>Z toward you</span></span>
      <div className="spatial-scene-readout"><span>OBJECT 01</span><output ref={positionRef} aria-label="Cube position" aria-live="off">X 0.00   Y 0.00   Z 0.00</output></div>
    </div>
    <div className="spatial-scene-footer">
      <p id={instructionId}>Drag to move · Arrow keys for X/Y · Page Up / Down for depth</p>
      {debugEnabled&&<output ref={metricsRef} className="spatial-scene-metrics" aria-label="Scene rendering performance" aria-live="off"/>}
    </div>
  </section>
}

export default SpatialScenePanel
