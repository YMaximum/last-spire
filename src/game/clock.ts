export interface ClockWork {
  speed: 1 | 2 | 3;
  background: boolean;
  canStep: (backgroundProgress: boolean) => boolean;
  step: () => void;
}

export function resolveDecisionPause(input: {
  queued: boolean;
  fusion: boolean;
  choiceWindow: boolean;
  windowPaused: boolean;
  autoPause: boolean;
  background: boolean;
  held: boolean;
}): { held: boolean; paused: boolean } {
  const pending = input.queued || input.fusion || input.choiceWindow;
  const held = pending && (input.held || input.background);
  return {
    held,
    paused:
      input.windowPaused ||
      input.fusion ||
      (input.queued && (input.autoPause || held)) ||
      (held && input.choiceWindow),
  };
}

/** A document-local clock: no wall timestamps are persisted or recovered. */
export class SimulationClock {
  private last: number | undefined;
  private debt = 0;
  private speed = 1;
  private background = false;
  private backgroundDebt = false;
  private blocked = true;

  constructor(
    private readonly tick: number,
    private readonly maxTicks = 120,
    private readonly budgetMs = 8,
    private readonly workTime = () => performance.now(),
  ) {}

  get catchingUp() {
    return this.debt + 1e-9 >= this.tick;
  }

  reset(now?: number) {
    this.last = now;
    this.debt = 0;
    this.backgroundDebt = false;
    this.blocked = true;
  }

  advance(now: number, work: ClockWork): number {
    if (!Number.isFinite(now)) return 0;
    const elapsed = this.last === undefined ? 0 : Math.max(0, (now - this.last) / 1000);
    this.last = now;
    this.debt += elapsed * this.speed;
    this.backgroundDebt ||= this.background || work.background;
    this.speed = work.speed;
    this.background = work.background;
    const canStep = () => work.canStep(this.backgroundDebt || work.background);
    if (!canStep() || this.blocked) {
      this.debt = 0;
      this.backgroundDebt = false;
      this.blocked = !canStep();
      return 0;
    }

    const deadline = this.workTime() + this.budgetMs;
    let ticks = 0;
    while (this.catchingUp && ticks < this.maxTicks && this.workTime() < deadline) {
      if (!canStep()) break;
      work.step();
      this.debt = Math.max(0, this.debt - this.tick);
      ticks++;
      if (!canStep()) {
        this.blocked = true;
        break;
      }
    }
    if (this.blocked || !canStep()) {
      // Time after a decision or defeat cannot be spent after resuming it.
      this.debt = 0;
      this.blocked = true;
    }
    if (!this.catchingUp) this.backgroundDebt = false;
    return ticks;
  }
}
