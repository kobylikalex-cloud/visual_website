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

/** Bent MCP + longer proximal phalanx: 62% reach despite a palmward folded tip.
 * Analytic anatomy motivated by local measured failure; not a copied recording.
 */
export function palmwardFist(mirror = false, proximalDegrees = 60): Detection {
  const d = controlHand('OPEN', mirror)
  for (const mcp of [5, 9, 13, 17]) {
    for (const [i, [length, bend]] of [[.04, 0], [.025, 70], [.02, 125]].entries()) {
      const angle = (proximalDegrees + bend) * Math.PI / 180, p = d.worldLandmarks[mcp + i]
      d.worldLandmarks[mcp + i + 1] = { x: p.x, y: p.y - length * Math.cos(angle), z: p.z + length * Math.sin(angle) }
    }
  }
  d.landmarks = d.worldLandmarks.map(p => ({ x: .5 + p.x, y: .5 + p.y - .016, z: p.z }))
  return d
}
