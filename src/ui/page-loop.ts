export interface LoopEnvironment {
  hidden: () => boolean;
  now: () => number;
  frame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  timer: (callback: () => void, ms: number) => number;
  cancelTimer: (id: number) => void;
  /** Resume bounded work sooner when a hidden callback could not drain its debt. */
  catchingUp?: () => boolean;
}

/** Owns exactly one callback: animation frames in view, low-frequency work hidden. */
export class PageLoop {
  private running = false;
  private working = false;
  private frameId: number | undefined;
  private timerId: number | undefined;
  constructor(
    private readonly work: (now: number) => void,
    private readonly env: LoopEnvironment,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.refresh();
  }

  refresh() {
    this.cancel();
    if (!this.running || this.working) return;
    this.working = true;
    try {
      this.work(this.env.now());
    } finally {
      this.working = false;
    }
    this.schedule();
  }

  stop() {
    this.running = false;
    this.cancel();
  }

  private cancel() {
    if (this.frameId !== undefined) this.env.cancelFrame(this.frameId);
    if (this.timerId !== undefined) this.env.cancelTimer(this.timerId);
    this.frameId = this.timerId = undefined;
  }

  private schedule() {
    if (!this.running) return;
    if (this.env.hidden())
      this.timerId = this.env.timer(() => this.refresh(), this.env.catchingUp?.() ? 16 : 1000);
    else this.frameId = this.env.frame(() => this.refresh());
  }
}
