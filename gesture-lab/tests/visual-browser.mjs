import assert from 'node:assert/strict'
import process from 'node:process'
import console from 'node:console'
import {spawn} from 'node:child_process'
import {mkdir, writeFile} from 'node:fs/promises'
import {setTimeout as wait} from 'node:timers/promises'
import {pathToFileURL} from 'node:url'

// Playwright is installed in a CI-only temporary directory, not the application.
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const output='../review/visual'
await mkdir(output,{recursive:true})
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'ignore'})
let browser
const report={checks:[],errors:[],timings:{},layouts:[],note:'Native input and software-rendered WebGL checks only. No webcam accuracy or hardware FPS claim.'}
try {
  let ready=false
  for(let i=0;i<80;i++) {
    try {if((await globalThis.fetch('http://127.0.0.1:4173/')).ok){ready=true;break}} catch { /* server starting */ }
    await wait(250)
  }
  assert.ok(ready,'preview server starts')
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1})
  page.on('pageerror',error=>report.errors.push(String(error)))
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text())})
  await page.goto('http://127.0.0.1:4173/spatial-lab',{waitUntil:'networkidle'})
  await page.locator('.spatial-scene-canvas').waitFor({state:'visible'})
  await page.waitForTimeout(1200)
  assert.equal(await page.locator('.spatial-scene-error').isVisible(),false,'WebGL construction succeeds')
  await page.screenshot({path:output+'/cinematic-desktop.png'})
  report.checks.push('WebGL scene renders; screenshot captured')
  const readout=page.locator('[aria-label="Cube position"]')
  const before=await readout.textContent()
  const box=await page.locator('.spatial-scene-canvas').boundingBox()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2)
  await page.mouse.down()
  await page.mouse.move(box.x+box.width/2+70,box.y+box.height/2-25,{steps:8})
  await page.mouse.up()
  await page.waitForTimeout(500)
  assert.notEqual(await readout.textContent(),before,'mouse drag still translates cube')
  const dragged=await readout.textContent()
  await page.locator('.spatial-scene-canvas').focus()
  await page.keyboard.press('PageUp')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(500)
  assert.notEqual(await readout.textContent(),dragged,'keyboard X/Z motion remains available')
  const resetStarted=Date.now()
  await page.getByRole('button',{name:/Reset position/}).click()
  // Coordinates are published by the existing RAF loop at most once per 300ms.
  // SwiftShader scheduling is not a client hardware latency benchmark. Await the
  // exact original coordinates with a finite timeout, never weaken the assertion.
  await page.waitForFunction(expected=>globalThis.document.querySelector('[aria-label="Cube position"]')?.textContent===expected,before,{timeout:5000,polling:100})
  assert.equal(await readout.textContent(),before,'reset restores original position')
  report.timings.resetReadoutIncludingAutomationMs=Date.now()-resetStarted
  report.checks.push('mouse drag, keyboard translation and reset pass')
  // An off-center pick must retain its grip offset. The real engine/projection
  // round-trip is covered in unit tests; this exercises the actual native handler.
  await page.mouse.move(box.x+box.width/2+22,box.y+box.height/2-12)
  await page.mouse.down()
  await page.mouse.move(box.x+box.width/2+22,box.y+box.height/2-12)
  await page.waitForTimeout(400)
  assert.equal(await readout.textContent(),before,'off-center drag at the same point preserves grip offset')
  await page.mouse.move(box.x+box.width/2+62,box.y+box.height/2-42,{steps:8})
  await page.mouse.up()
  await page.waitForFunction(expected=>globalThis.document.querySelector('[aria-label="Cube position"]')?.textContent!==expected,before,{timeout:5000,polling:100})
  const offCenter=await readout.textContent()
  const coordinates=offCenter.match(/-?\d+\.\d+/g).map(Number)
  assert.ok(coordinates[0]>0&&coordinates[1]>0,'off-center drag follows right and up')
  assert.equal(coordinates[2],0,'native XY drag does not alter depth')
  await page.getByRole('button',{name:/Reset position/}).click()
  await page.waitForFunction(expected=>globalThis.document.querySelector('[aria-label="Cube position"]')?.textContent===expected,before,{timeout:5000,polling:100})
  report.checks.push('off-center grab has no jump, preserves offset and leaves Z unchanged')
  await page.getByRole('button',{name:'Debug: OFF',exact:true}).click()
  await page.getByRole('button',{name:'Debug: ON',exact:true}).waitFor()
  await page.screenshot({path:output+'/cinematic-debug.png',fullPage:true})
  await page.getByRole('button',{name:'Debug: ON',exact:true}).click()
  report.checks.push('debug toggles without starting camera')
  for(const width of [1280,1024,768,390]) {
    await page.setViewportSize({width,height:900})
    await page.waitForTimeout(250)
    assert.ok(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.innerWidth+1),'no horizontal overflow at '+width)
    report.layouts.push(await page.evaluate(()=>{
      const stage=globalThis.document.querySelector('.spatial-scene-canvas').getBoundingClientRect()
      return {width:globalThis.innerWidth,canvasWidth:stage.width,canvasHeight:stage.height}
    }))
    if(width===390)await page.screenshot({path:output+'/cinematic-mobile.png',fullPage:true})
  }
  report.checks.push('no horizontal overflow at 1280/1024/768/390px')
  await page.setViewportSize({width:1600,height:1000})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.screenshot({path:output+'/cinematic-reduced-motion.png'})
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'networkidle'})
  assert.equal(await page.locator('.spatial-mode').count(),0,'original route remains separate')
  await page.locator('[data-gesture-target="test-0"]').click()
  assert.ok((await page.locator('[data-gesture-target="test-0"]').textContent()).includes('1 activations'))
  report.checks.push('original playground route and native button activation pass')
  assert.deepEqual(report.errors,[],'no browser runtime or shader errors')
  console.log(JSON.stringify(report,null,2))
} finally {
  await writeFile(output+'/browser-report.json',JSON.stringify(report,null,2))
  await browser?.close()
  server.kill()
}
