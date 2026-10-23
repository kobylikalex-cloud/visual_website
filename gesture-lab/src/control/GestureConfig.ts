/** Prototype defaults, not accuracy claims. Timing derives from the existing 20 Hz loop.
 * Geometry bands reuse the observed hybrid baseline; user calibration adjusts movement only.
 */
export const DEFAULT_GESTURE_CONFIG = {
  confirmationMs: 150,
  graspConfirmationMs: 200,
  // Dormant closing bridge: existing 150ms intent + 200ms grasp intervals.
  closingTransitionMs: 350,
  scrollConfirmationMs: 180,
  freshnessMs: 200,
  trackMatchDistance: 0.18,
  trackAmbiguityMargin: 0.035,
  crossingDistance: 0.12,
  pointerSmoothingMs: 140,
  pointerDeadZone: 0.007,
  pointerMinX: 0.08,
  pointerMaxX: 0.92,
  pointerMinY: 0.08,
  pointerMaxY: 0.92,
  targetEnterRadius: 95,
  targetExitRadius: 145,
  targetSwitchMargin: 18,
  targetLockMs: 150,
  maxClickMotion: 90, // independent of magnetic focus radius
  scrollDeadZone: 0.12,
  scrollRange: 0.20,
  maxScrollSpeed: 200,
  twoHandMultiplier: 3,
}
export type GestureConfig = typeof DEFAULT_GESTURE_CONFIG
