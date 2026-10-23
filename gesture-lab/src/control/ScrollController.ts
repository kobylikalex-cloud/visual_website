import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './GestureConfig.ts'
import type { TrackedHand } from './types.ts'

type FlatIntent = { since: number; neutralY: number | null }

/** Every identity owns its own flat confirmation and neutral. */
export class ScrollController {
  private config: GestureConfig
  private intents = new Map<number, FlatIntent>()
  private filteredVelocity = 0
  private lastVelocityMs: number | null = null

  constructor(config: GestureConfig = DEFAULT_GESTURE_CONFIG) { this.config = config }

  reset() {
    this.intents.clear()
    this.filteredVelocity = 0
    this.lastVelocityMs = null
  }

  // Ease into scrolling; stop immediately at neutral, disagreement or reversal.
  // This filters hand-position jitter without allowing momentum after tracking loss.
  private smooth(target: number, now: number): number {
    const dt = this.lastVelocityMs === null ? 50 : Math.max(0, Math.min(100, now - this.lastVelocityMs))
    this.lastVelocityMs = now
    if (target === 0) {
      this.filteredVelocity = 0
      return 0
    }
    if (Math.sign(this.filteredVelocity) !== Math.sign(target)) this.filteredVelocity = 0
    const alpha = 1 - Math.exp(-dt / 150)
    this.filteredVelocity += alpha * (target - this.filteredVelocity)
    return this.filteredVelocity
  }

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
    if (!confirmed) return { confirmed: false, velocity: this.smooth(0, timestampMs) }
    if (hands.length === 1) return { confirmed: true, velocity: this.smooth(velocities[0], timestampMs) }
    if (velocities[0] === 0 || velocities[1] === 0 ||
      Math.sign(velocities[0]) !== Math.sign(velocities[1])) {
      return { confirmed: true, velocity: this.smooth(0, timestampMs) }
    }
    return { confirmed: true, velocity: this.smooth(
      (velocities[0] + velocities[1]) / 2 * this.config.twoHandMultiplier, timestampMs
    ) }
  }
}
