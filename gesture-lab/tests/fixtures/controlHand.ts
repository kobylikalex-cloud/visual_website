import type { Detection } from '../../src/control/types.ts'

/** Analytic scale-normalized bones; fixtures are not webcam accuracy evidence. */
export function controlHand(pose: 'OPEN' | 'FIST' | 'PARTIAL' = 'OPEN', mirror = false): Detection {
  const world = Array.from({ length: 21 }, () => ({ x: 0, y: .04, z: 0 }))
  world[0] = { x: 0, y: .08, z: 0 }
  for (const [index, mcp] of [5, 9, 13, 17].entries()) {
    world[mcp] = { x: (index - 1.5) * .025, y: 0, z: 0 }
    const curled = pose === 'FIST' || pose === 'PARTIAL' && index !== 0
    let angle = 0
    for (let bone = 1; bone <= 3; bone++) {
      if (bone === 2 && curled) angle += Math.PI / 2
      if (bone === 3 && curled) angle += 53 * Math.PI / 180
      const length = bone === 2 ? .012 : .03, previous = world[mcp + bone - 1]
      world[mcp + bone] = { x: previous.x, y: previous.y - length * Math.cos(angle), z: previous.z + length * Math.sin(angle) }
    }
  }
  const worldLandmarks = world.map(p => ({ ...p, x: mirror ? -p.x : p.x }))
  const landmarks = worldLandmarks.map(p => ({ x: .5 + p.x, y: .5 + p.y - .016, z: p.z }))
  return { landmarks, worldLandmarks, handedness: mirror ? 'Right' : 'Left' }
}
