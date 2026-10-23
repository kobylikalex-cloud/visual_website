import type { HandPose } from './HandPoseEngine.ts'

/** Publish known poses only after confirmation; uncertainty clears output immediately. */
export class HandPoseStabilizer {
  private stable: HandPose = 'UNKNOWN'
  private candidate: HandPose | null = null
  private candidateSince = 0
  private lastTimestamp: number | null = null
  private readonly confirmMs: number

  constructor(confirmMs = 150) {
    if (!Number.isFinite(confirmMs) || confirmMs < 0) throw new RangeError('Invalid confirmation duration')
    this.confirmMs = confirmMs
  }

  update(raw: HandPose, timestampMs: number): HandPose {
    if (!Number.isFinite(timestampMs) ||
      (this.lastTimestamp !== null && timestampMs < this.lastTimestamp)) {
      this.reset()
      return 'UNKNOWN'
    }
    this.lastTimestamp = timestampMs

    if (raw === 'UNKNOWN') {
      this.stable = 'UNKNOWN'
      this.candidate = null
      return this.stable
    }
    if (raw === this.stable) {
      this.candidate = null
      return this.stable
    }

    this.stable = 'UNKNOWN'
    if (raw !== this.candidate) {
      this.candidate = raw
      this.candidateSince = timestampMs
    }
    if (timestampMs - this.candidateSince >= this.confirmMs) {
      this.stable = raw
      this.candidate = null
    }
    return this.stable
  }

  reset(): void {
    this.stable = 'UNKNOWN'
    this.candidate = null
    this.candidateSince = 0
    this.lastTimestamp = null
  }
}
