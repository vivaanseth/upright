export type SamplingTarget = 3 | 5 | 8;

export interface SamplingConditions {
  onBattery: boolean;
  reduceOnBattery: boolean;
  latencyEwmaMs: number | null;
  dropRate: number;
}

export class AdaptiveSamplingController {
  private target: SamplingTarget = 5;
  private changedAt: number;
  private headroomStartedAt: number | null = null;

  constructor(now = 0) {
    this.changedAt = now;
  }

  get current(): SamplingTarget {
    return this.target;
  }

  next(conditions: SamplingConditions, now: number): SamplingTarget {
    const dwellMs = now - this.changedAt;
    const transition = (target: SamplingTarget): SamplingTarget => {
      if (target !== this.target) {
        this.target = target;
        this.changedAt = now;
      }
      return this.target;
    };
    const reducedBattery = conditions.reduceOnBattery && conditions.onBattery;
    if (
      reducedBattery ||
      (conditions.latencyEwmaMs ?? 0) > 150 ||
      conditions.dropRate > 0.2
    ) {
      this.headroomStartedAt = null;
      return dwellMs >= 3_000 ? transition(3) : this.target;
    }
    if (
      this.target === 8 &&
      ((conditions.latencyEwmaMs ?? 0) > 100 || conditions.dropRate > 0.1)
    ) {
      this.headroomStartedAt = null;
      return dwellMs >= 5_000 ? transition(5) : this.target;
    }

    const hasHeadroom =
      !reducedBattery &&
      conditions.latencyEwmaMs !== null &&
      conditions.latencyEwmaMs < 80 &&
      conditions.dropRate < 0.05;
    if (hasHeadroom) this.headroomStartedAt ??= now;
    else this.headroomStartedAt = null;

    if (this.target === 3 && dwellMs >= 10_000) return transition(5);
    if (
      this.target === 5 &&
      this.headroomStartedAt !== null &&
      now - this.headroomStartedAt >= 10_000 &&
      dwellMs >= 10_000
    )
      return transition(8);
    return this.target;
  }

  reset(now: number): void {
    this.target = 5;
    this.changedAt = now;
    this.headroomStartedAt = null;
  }
}
