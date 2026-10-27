type Point = { x: number; y: number }
export interface AdaptivePointerFilterOptions {
  /** Stationary time constant in milliseconds;140ms gives min cutoff1.137Hz. */
  baselineTimeConstantMs?: number
  /** Cutoff increase in Hz per(pixel/second), default0.01. Points must be screen pixels. */
  beta?: number
  /** Lowpass cutoff for the source-sample velocity estimate; default1Hz. */
  derivativeCutoffHz?: number
}

/**
 * Speed-adaptive lowpass following Casiez, Roussel and Vogel's1€ filter:
 * https://gery.casiez.net/1euro/ (CHI2012; DOI10.1145/2207676.2208639).
 *
 * Adaptations for camera samples rendered on a separate RAF clock:
 * - velocity uses successive RAW source samples and source time only;
 * - a shared2D speed controls both axes, preserving movement direction;
 * - exact exponential integration replaces the paper's discretized RC alpha,
 *   so subdividing a held interval into more render frames has no effect;
 * - new target/cutoff apply at publication(render) time, never retroactively.
 *
 * There is no deadzone, gesture decision, prediction, or extrapolation here.
 * Duplicate/stale source timestamps retain the accepted target and cutoff.
 * Reset when tracking/clutching ends so old derivative/travel cannot leak in.
 */
export class AdaptivePointerFilter {
  private readonly minCutoffHz: number
  private readonly beta: number
  private readonly derivativeCutoffHz: number
  private cutoffHz: number
  private position: Point | null = null
  private target: Point | null = null
  private velocity: Point = { x: 0, y: 0 }
  private sourceTimestampMs: number | null = null
  private renderTimestampMs: number | null = null

  constructor(options: AdaptivePointerFilterOptions = {}) {
    const baselineTimeConstantMs = options.baselineTimeConstantMs ?? 140
    this.beta = options.beta ?? .01
    this.derivativeCutoffHz = options.derivativeCutoffHz ?? 1
    if (!Number.isFinite(baselineTimeConstantMs) || baselineTimeConstantMs <= 0
      || !Number.isFinite(this.beta) || this.beta < 0
      || !Number.isFinite(this.derivativeCutoffHz) || this.derivativeCutoffHz <= 0) {
      throw new RangeError('Filter tuning must be finite, with positive time constant/cutoff and nonnegative beta')
    }
    this.minCutoffHz = 1000 / (2 * Math.PI * baselineTimeConstantMs)
    if (!Number.isFinite(this.minCutoffHz) || this.minCutoffHz <= 0) throw new RangeError('Baseline cutoff must be finite and positive')
    this.cutoffHz = this.minCutoffHz
  }

  update(point: Point, sourceTimestampMs: number, renderTimestampMs: number): Point {
    if (![point.x, point.y, sourceTimestampMs, renderTimestampMs].every(Number.isFinite)) {
      throw new RangeError('Filter point and timestamps must be finite')
    }
    if (this.position === null || this.target === null || this.sourceTimestampMs === null || this.renderTimestampMs === null) {
      this.position = { ...point }; this.target = { ...point }
      this.sourceTimestampMs = sourceTimestampMs; this.renderTimestampMs = renderTimestampMs
      return { ...this.position }
    }
    if (renderTimestampMs < this.renderTimestampMs) return { ...this.position }

    let nextVelocity = this.velocity
    let nextCutoffHz = this.cutoffHz
    const fresh = sourceTimestampMs > this.sourceTimestampMs
    if (fresh) {
      const sourceSeconds = (sourceTimestampMs - this.sourceTimestampMs) / 1000
      const rawVelocity = { x: (point.x - this.target.x) / sourceSeconds, y: (point.y - this.target.y) / sourceSeconds }
      if (![rawVelocity.x, rawVelocity.y].every(Number.isFinite)) throw new RangeError('Source velocity must be finite')
      const alpha = -Math.expm1(-2 * Math.PI * this.derivativeCutoffHz * sourceSeconds)
      nextVelocity = {
        x: (1 - alpha) * this.velocity.x + alpha * rawVelocity.x,
        y: (1 - alpha) * this.velocity.y + alpha * rawVelocity.y,
      }
      nextCutoffHz = this.minCutoffHz + this.beta * Math.hypot(nextVelocity.x, nextVelocity.y)
      if (!Number.isFinite(nextCutoffHz)) throw new RangeError('Adaptive cutoff must be finite')
    }

    const renderSeconds = (renderTimestampMs - this.renderTimestampMs) / 1000
    const alpha = -Math.expm1(-2 * Math.PI * this.cutoffHz * renderSeconds)
    this.position = {
      x: this.position.x === this.target.x ? this.position.x : (1 - alpha) * this.position.x + alpha * this.target.x,
      y: this.position.y === this.target.y ? this.position.y : (1 - alpha) * this.position.y + alpha * this.target.y,
    }
    this.renderTimestampMs = renderTimestampMs
    if (fresh) {
      this.velocity = nextVelocity
      this.cutoffHz = nextCutoffHz
      this.target = { ...point }
      this.sourceTimestampMs = sourceTimestampMs
    }
    return { ...this.position }
  }

  reset() {
    this.position = null; this.target = null
    this.velocity = { x: 0, y: 0 }
    this.sourceTimestampMs = null; this.renderTimestampMs = null
    this.cutoffHz = this.minCutoffHz
  }
}
