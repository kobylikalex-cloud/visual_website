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
  pointerGain: 1.6,
  pointerMinX: 0.15,
  pointerMaxX: 0.85,
  pointerMinY: 0.15,
  pointerMaxY: 0.85,
  targetEnterRadius: 55,
  targetExitRadius: 90,
  targetSwitchMargin: 18,
  targetLockMs: 150,
  scrollDeadZone: 0.12,
  scrollRange: 0.20,
  maxScrollSpeed: 200,
  twoHandMultiplier: 3,
}
export type GestureConfig = typeof DEFAULT_GESTURE_CONFIG & { pointerMode?: 'absolute' | 'relative'; pointerFilter?: 'fixed' | 'adaptive'; pointerPreview?: boolean }
/** App opt-in; historical library defaults remain available for comparison. */
export const TOUCHPAD_MOVEMENT_RANGE = .35
export const TOUCHPAD_GESTURE_CONFIG: GestureConfig = { ...DEFAULT_GESTURE_CONFIG, pointerMode: 'relative', pointerFilter: 'adaptive', pointerPreview: true,
  pointerMinX: .5-TOUCHPAD_MOVEMENT_RANGE/2, pointerMaxX: .5+TOUCHPAD_MOVEMENT_RANGE/2,
  pointerMinY: .5-TOUCHPAD_MOVEMENT_RANGE/2, pointerMaxY: .5+TOUCHPAD_MOVEMENT_RANGE/2 }
