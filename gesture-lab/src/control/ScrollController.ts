import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import type { TrackedHand } from './types.ts'

type FlatIntent = { since: number; neutralY: number | null }

/** Every identity owns its own flat confirmation and neutral. */
export class ScrollController {
  private config: GestureConfig
  private intents = new Map<number, FlatIntent>()

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) { this.config = config }

  reset() { this.intents.clear() }

  update(hands: TrackedHand[], timestampMs: number): { confirmed: boolean; velocity: number } {
    if (hands.length < 1 || hands.length > 2 || hands.some(hand => hand.pose !== 'OPEN' || hand.orientation !== 'FLAT_LIKE')) {
      this.reset()
      return { confirmed: false, velocity: 0 }
    }
    if ([...this.intents.keys()].some(id => !hands.some(hand => hand.id === id))) this.reset()
    const velocities: number[] = []
    let confirmed = true
    for (const hand of hands) {
      let intent = this.intents.get(hand.id)
      if (!intent) { intent = { since: timestampMs, neutralY: null }; this.intents.set(hand.id, intent) }
      if (intent.neutralY === null && timestampMs - intent.since >= this.config.scrollConfirmationMs) intent.neutralY = hand.center.y
      if (intent.neutralY === null) { confirmed = false; velocities.push(0); continue }
      const distance = hand.center.y - intent.neutralY
      const amount = Math.max(0, Math.min(1, (Math.abs(distance) - this.config.scrollDeadZone) / Math.max(.001, this.config.scrollRange - this.config.scrollDeadZone)))
      const ramp = amount * amount * (3 - 2 * amount)
      velocities.push(Math.sign(distance) * ramp * this.config.maxScrollSpeed)
    }
    if (!confirmed) return { confirmed: false, velocity: 0 }
    if (hands.length === 1) return { confirmed: true, velocity: velocities[0] }
    if (velocities[0] === 0 || velocities[1] === 0 || Math.sign(velocities[0]) !== Math.sign(velocities[1])) return { confirmed: true, velocity: 0 }
    return { confirmed: true, velocity: (velocities[0] + velocities[1]) / 2 * this.config.twoHandMultiplier }
  }
}
