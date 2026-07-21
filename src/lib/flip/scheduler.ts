import type { Flight } from "./flight";
import type { FlipOptions } from "./options";

export interface SchedulerHost {
  /** Repaint the resting composite. Runs once per frame, before flights draw. */
  renderStatic(): void;
  /** Fold a finished turn into the resting state. */
  commit(flight: Flight): void;
}

/**
 * The single rAF loop that advances every turn in the air.
 *
 * This is the piece StPageFlip could not offer: it held one controller and one
 * set of shadow elements, and calling flip() mid-animation silently dropped the
 * call. Here each turn is an independent object, so a rapid burst genuinely
 * overlaps instead of queueing behind a timer.
 */
export class FlightScheduler {
  private flights: Flight[] = [];
  private raf: number | null = null;
  private destroyed = false;

  constructor(
    private readonly host: SchedulerHost,
    private readonly options: FlipOptions
  ) {}

  get count(): number {
    return this.flights.length;
  }

  get busy(): boolean {
    return this.flights.length > 0;
  }

  /** Where the book will be once everything currently airborne has landed. */
  projectedPos(fallback: number): number {
    const last = this.flights[this.flights.length - 1];
    return last ? last.landPos : fallback;
  }

  add(flight: Flight): void {
    if (this.destroyed) return;
    this.flights.push(flight);
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (this.raf === null && !this.destroyed) {
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number): void => {
    this.raf = null;
    if (this.destroyed) return;

    const duration = Math.max(1, this.options.flipMs);

    // The composite is rebuilt every frame so flights can layer over a known
    // baseline; each flight then paints on top in spawn order.
    this.host.renderStatic();

    for (const flight of this.flights) {
      const t = (now - flight.startedAt) / duration;
      flight.advanceTo(t);

      // Note this sits OUTSIDE the draw: at exactly t=1 the geometry is
      // degenerate (the page lies flat, its edge collinear with the book's) and
      // the frame is skipped — but the turn must still commit.
      if (t >= 1 && !flight.committed) this.finish(flight);
    }

    this.flights = this.flights.filter((f) => !f.committed);

    if (this.flights.length) this.ensureRunning();
    else this.host.renderStatic();
  };

  private finish(flight: Flight): void {
    flight.committed = true;
    flight.destroy();
    this.host.commit(flight);
  }

  /**
   * Land everything immediately, in spawn order so the last one wins — which is
   * the position the user was heading for.
   *
   * Used on resize (a FlipCalculation is built against the old page size and
   * cannot be rescaled mid-air), and on teardown.
   */
  landAll(): void {
    for (const flight of this.flights) {
      if (!flight.committed) this.finish(flight);
    }
    this.flights = [];
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  destroy(): void {
    this.landAll();
    this.destroyed = true;
  }
}
