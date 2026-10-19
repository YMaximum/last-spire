export interface FrameSample {
  seconds: number;
  simulationMs: number;
  renderMs: number;
  foreground: boolean;
}

/** Bounded foreground-only measurements; background throttling is not a device benchmark. */
export class FrameMeter {
  private samples: FrameSample[] = [];
  private seconds = 0;
  private foreground = false;

  record(sample: FrameSample): void {
    const wasForeground = this.foreground;
    this.foreground = sample.foreground;
    if (!sample.foreground) {
      this.samples.length = 0;
      this.seconds = 0;
      return;
    }
    if (!wasForeground) return; // The first callback may span the entire background gap.
    if (
      !Number.isFinite(sample.seconds) ||
      sample.seconds <= 0 ||
      !Number.isFinite(sample.simulationMs) ||
      sample.simulationMs < 0 ||
      !Number.isFinite(sample.renderMs) ||
      sample.renderMs < 0
    ) {
      this.samples.length = 0;
      this.seconds = 0;
      return;
    }
    this.samples.push({ ...sample });
    this.seconds += sample.seconds;
    // Retain real stalls until they leave the recent ten-second window.
    while (
      this.samples.length > 1 &&
      (this.samples.length > 1024 || this.seconds - this.samples[0].seconds >= 10)
    )
      this.seconds -= this.samples.shift()!.seconds;
  }

  read() {
    const frames = this.samples.length;
    const seconds = this.seconds;
    const mean = (key: 'simulationMs' | 'renderMs') =>
      this.samples.reduce((sum, s) => sum + s[key], 0) / Math.max(1, frames);
    const intervals = this.samples.map((s) => s.seconds * 1000).sort((a, b) => a - b);
    return {
      status: !this.foreground ? 'background' : seconds < 3 ? 'warming-up' : 'foreground',
      frames,
      seconds,
      fps: seconds ? frames / seconds : 0,
      simulationMs: mean('simulationMs'),
      renderMs: mean('renderMs'),
      frameP95Ms: intervals[Math.max(0, Math.ceil(frames * 0.95) - 1)] || 0,
    } as const;
  }
}
