import type { Flight } from "./flight";
import type { BookLayout } from "./layout";
import type { SheetModel } from "./model";
import type { FlipOptions } from "./options";
import { Corner, Direction } from "./types";

export interface DragContext {
  readonly model: SheetModel;
  readonly layout: BookLayout;
  readonly options: FlipOptions;
  readonly host: HTMLElement;
  /** False while turns are animating, or when motion is reduced. */
  canStart(): boolean;
  spawn(
    direction: Direction,
    sheetIdx: number,
    landPos: number,
    corner: Corner
  ): Flight | null;
  renderStatic(): void;
  /** Apply a completed drag's landing position. */
  land(flight: Flight): void;
  /** Re-render and notify after any drag ends. */
  settle(): void;
}

/**
 * Turns pointer movement into a flight.
 *
 * A dragged turn is the *same* Flight object an animated one uses, just fed
 * positions from the cursor instead of from the clock — which is why dragging
 * and clicking produce an identical curl.
 */
export class DragController {
  private active: Flight | null = null;
  private pointerId: number | null = null;
  private releasing = 0;
  private destroyed = false;

  constructor(private readonly ctx: DragContext) {
    const el = ctx.host;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    // Fires when the OS takes over the gesture (scroll hand-off, tab switch).
    // Without it the book would be left mid-turn with no way to finish.
    el.addEventListener("pointercancel", this.onUp);
  }

  /** True while a drag or its release animation is running. */
  get busy(): boolean {
    return this.active !== null || this.releasing > 0;
  }

  private onDown = (e: PointerEvent): void => {
    if (this.destroyed || this.active || e.button !== 0) return;
    if (this.releasing > 0 || !this.ctx.canStart()) return;

    const { layout, model } = this.ctx;
    const box = this.ctx.host.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;

    if (
      x < layout.left ||
      x > layout.left + layout.width ||
      y < layout.top ||
      y > layout.top + layout.height
    ) {
      return;
    }

    const direction = x > layout.spineX ? Direction.Forward : Direction.Back;
    const sheetIdx = model.sheetIndexFor(model.pos, direction);
    if (!model.hasSheet(sheetIdx)) return;

    const corner =
      y > layout.top + layout.height / 2 ? Corner.Bottom : Corner.Top;
    const landPos =
      direction === Direction.Forward ? sheetIdx + 1 : sheetIdx;

    const flight = this.ctx.spawn(direction, sheetIdx, landPos, corner);
    if (!flight) return;

    this.active = flight;
    this.pointerId = e.pointerId;

    // Capture so a fast drag that leaves the element still delivers move/up.
    try {
      this.ctx.host.setPointerCapture(e.pointerId);
    } catch {
      /* not all pointer types support capture */
    }

    this.onMove(e);
    e.preventDefault();
  };

  private onMove = (e: PointerEvent): void => {
    const flight = this.active;
    if (!flight || e.pointerId !== this.pointerId) return;

    const box = this.ctx.host.getBoundingClientRect();
    const point = this.ctx.layout.toPage(
      { x: e.clientX - box.left, y: e.clientY - box.top },
      flight.direction
    );

    this.ctx.renderStatic();
    flight.moveTo(point);
  };

  private onUp = (e: PointerEvent): void => {
    const flight = this.active;
    if (!flight || e.pointerId !== this.pointerId) return;

    this.active = null;
    this.pointerId = null;

    // A press that never moved has no valid geometry yet. Treat it as a click
    // and tear down, rather than animating a release from a null position.
    if (!flight.calc.getPosition()) {
      flight.destroy();
      this.ctx.renderStatic();
      return;
    }

    this.release(
      flight,
      flight.progress > this.ctx.options.dragCompleteThreshold
    );
  };

  /** Animate the flap the rest of the way over, or back where it came from. */
  private release(flight: Flight, complete: boolean): void {
    const from = flight.calc.getPosition();
    if (!from) {
      this.teardown(flight, false);
      return;
    }

    const { layout, options } = this.ctx;
    const yDest = flight.calc.corner === Corner.Bottom ? layout.height : 0;
    const dest = complete
      ? { x: -layout.pageWidth, y: yDest }
      : { x: layout.pageWidth, y: yDest };

    const startedAt = performance.now();
    const duration = Math.max(1, options.flipMs * options.dragReleaseScale);

    this.releasing += 1;

    const step = (now: number): void => {
      if (this.destroyed) return;
      const t = Math.min(1, (now - startedAt) / duration);
      this.ctx.renderStatic();
      flight.moveTo({
        x: from.x + (dest.x - from.x) * t,
        y: from.y + (dest.y - from.y) * t,
      });
      if (t < 1) requestAnimationFrame(step);
      else this.teardown(flight, complete);
    };

    requestAnimationFrame(step);
  }

  private teardown(flight: Flight, complete: boolean): void {
    flight.destroy();
    this.releasing = Math.max(0, this.releasing - 1);
    if (complete) this.ctx.land(flight);
    this.ctx.settle();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.active) {
      this.active.destroy();
      this.active = null;
    }
    const el = this.ctx.host;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
  }
}
