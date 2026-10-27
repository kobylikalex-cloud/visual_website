type PageDriver = { read(): { top: number; max: number }; write(top: number): void }

/** Native controls own their Space/arrows/taps; actual page navigation cancels
 * gesture intent without preventing the browser's default input behavior.
 */
export function interruptsPageInput(kind: 'keydown' | 'touchstart' | 'wheel', key: string, onControl: boolean): boolean {
  if (kind === 'wheel' || key === 'Escape') return true
  if (onControl) return false
  return kind === 'touchstart' || ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key)
}

/** Explicit document-scroll boundary. No wheel events, OS input or event queues. */
export class PageScrollTarget {
  private driver: PageDriver
  private expected: { top: number; time: number } | null = null
  private remainder = 0
  private direction = 0
  private lastInput: number | null = null
  constructor(driver: PageDriver) { this.driver = driver }
  stop() { this.remainder = 0; this.direction = 0; this.lastInput = null }
  clear() { this.expected = null; this.stop() }
  apply(delta: number, now: number, captureTime: number): number {
    if (!Number.isFinite(delta + now + captureTime) || now < captureTime || now - captureTime > 200) { this.clear(); return 0 }
    if (delta === 0) { this.stop(); return 0 }
    if (Math.sign(delta) !== this.direction || this.lastInput !== null && now - this.lastInput > 120) this.stop()
    this.direction = Math.sign(delta); this.lastInput = now
    const { top, max } = this.driver.read()
    if (!Number.isFinite(top + max) || max < 0) { this.clear(); return 0 }
    const step = Math.max(-100, Math.min(100, delta + this.remainder))
    const next = Math.max(0, Math.min(max, top + step))
    if (next === top) { this.stop(); return 0 }
    this.driver.write(next)
    const actual = this.driver.read().top
    // Carry at most one pixel of native rounding error, never a queue of old
    // motion. Stop/reversal/staleness/edges discard it immediately.
    this.remainder = next === 0 || next === max ? 0 : Math.max(-1, Math.min(1, step - (actual - top)))
    this.expected = { top: actual, time: now }
    return actual - top
  }
  isOwnScroll(top: number, now: number): boolean {
    return this.expected !== null && Number.isFinite(top + now) && now >= this.expected.time &&
      now - this.expected.time <= 120 && Math.abs(top - this.expected.top) <= 1
  }
}
