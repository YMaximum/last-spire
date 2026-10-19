/** Presentation hysteresis keeps short frame stalls from flashing a notice. */
export class CatchupStatus {
  private busySince: number | undefined;
  private shownAt: number | undefined;
  private text = '';

  update(now: number, pendingSeconds: number, background: boolean): string {
    if (pendingSeconds >= 0.5) {
      this.busySince ??= now;
      if (now - this.busySince >= 1000) {
        this.shownAt ??= now;
        this.text = background
          ? 'Catching up after time away. Your next decision still pauses combat.'
          : 'Battle under heavy load. Try 1× speed or fewer visual effects.';
      }
    } else {
      this.busySince = undefined;
      if (this.shownAt !== undefined && now - this.shownAt >= 1500) {
        this.shownAt = undefined;
        this.text = '';
      }
    }
    return this.text;
  }
}
