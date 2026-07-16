export class Countdown {
  private availableAt = 0;
  private timer: number | null = null;

  get remainingSeconds() {
    return Math.max(0, Math.ceil((this.availableAt - Date.now()) / 1000));
  }

  start(seconds: number, onTick: () => void) {
    this.clear();
    const duration = Number.isFinite(seconds) ? Math.max(1, seconds) : 60;
    this.availableAt = Date.now() + duration * 1000;
    onTick();
    this.timer = window.setInterval(() => {
      onTick();
      if (this.remainingSeconds === 0) this.clear();
    }, 1000);
  }

  clear() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.availableAt = 0;
  }
}
