import { FlipCalculation } from "./geometry/flip-calculation";
import type { BookLayout } from "./layout";
import type { SheetModel } from "./model";
import type { FlipOptions } from "./options";
import { rendererFor } from "./renderers/registry";
import type { FlightView, SheetRenderer } from "./renderers/types";
import { Corner, Direction } from "./types";
import type { Point, Roles, Sheet } from "./types";

export interface FlightInit {
  model: SheetModel;
  layout: BookLayout;
  options: FlipOptions;
  host: HTMLElement;
  direction: Direction;
  sheetIdx: number;
  /** Position the book lands on when this turn commits. */
  landPos: number;
  corner: Corner;
  /** Monotonic spawn counter; drives z-order so later turns stack on top. */
  seq: number;
}

/**
 * One turn in the air.
 *
 * Owns its DOM (the flap clone) and its renderer, and knows nothing about how
 * it is driven — the scheduler advances timed turns, the drag controller
 * advances one from the pointer. That is why a dragged turn and an animated one
 * look identical: they are the same object fed different positions.
 */
export class Flight implements FlightView {
  readonly calc: FlipCalculation;
  readonly direction: Direction;
  readonly sheet: Sheet;
  readonly roles: Roles;
  readonly layout: BookLayout;
  readonly options: FlipOptions;
  readonly host: HTMLElement;
  readonly leadEl: HTMLElement;
  readonly restEl: HTMLElement | null;
  readonly bottomEl: HTMLElement | null;
  readonly z: number;

  readonly landPos: number;
  readonly sheetIdx: number;
  readonly startedAt: number;

  /** Set once the turn has been folded into the resting composite. */
  committed = false;
  /** Latest progress, 0-100. Used by the drag controller's release decision. */
  progress = 0;

  private readonly renderer: SheetRenderer;
  private readonly model: SheetModel;

  /** Path a timed turn follows, in page space. */
  readonly from: Point;
  readonly to: Point;

  constructor(init: FlightInit, now: number) {
    const { model, layout, options } = init;
    this.model = model;
    this.layout = layout;
    this.options = options;
    this.host = init.host;
    this.direction = init.direction;
    this.sheetIdx = init.sheetIdx;
    this.landPos = init.landPos;
    this.startedAt = now;

    this.sheet = model.sheets[init.sheetIdx];
    this.roles = model.roles(init.direction, this.sheet);

    const lead = model.sideAt(this.roles.leadIdx);
    const rest = model.sideAt(this.roles.restIdx);
    const bottom = model.sideAt(this.roles.bottomIdx);

    // The flap MUST be a clone — the original stays flat underneath so the
    // un-turned remainder of the sheet keeps rendering.
    this.leadEl = lead!.el.cloneNode(true) as HTMLElement;
    this.leadEl.classList.add("book-flight-clone");
    this.leadEl.setAttribute("aria-hidden", "true");
    this.host.appendChild(this.leadEl);

    this.restEl = rest ? rest.el : null;
    this.bottomEl = bottom ? bottom.el : null;

    // Bands reserved per flight: bottom at z-10, flap at z, shadows above.
    this.z = 20 + init.seq;

    this.calc = new FlipCalculation(
      init.direction,
      init.corner,
      layout.pageWidth,
      layout.height
    );

    // Both directions run the same path. BACK page space is mirrored, so that
    // already means "swings the other way" — also reversing time would cancel
    // out and the turn would run backwards.
    const margin = layout.height / 10;
    this.from = { x: layout.pageWidth - margin, y: margin };
    this.to = { x: -layout.pageWidth, y: 0 };

    this.renderer = rendererFor(this.sheet.kind)(this);
  }

  restInSlot(): boolean {
    return this.direction === Direction.Forward
      ? this.model.rightSideIndex() === this.roles.restIdx
      : this.model.leftSideIndex() === this.roles.restIdx;
  }

  /** Advance to a normalised time 0..1 along the flight path. */
  advanceTo(t: number): void {
    const eased = this.options.easing(Math.max(0, Math.min(1, t)));
    this.moveTo({
      x: this.from.x + (this.to.x - this.from.x) * eased,
      y: this.from.y + (this.to.y - this.from.y) * eased,
    });
  }

  /** Drive from an explicit page-space corner position (drag). */
  moveTo(point: Point): void {
    if (this.calc.calc(point)) {
      this.progress = this.calc.getFlippingProgress();
      this.renderer.draw();
    }
  }

  /** Redraw at the current position without recomputing geometry. */
  redraw(): void {
    if (this.calc.ready) this.renderer.draw();
  }

  destroy(): void {
    this.renderer.destroy();
    this.leadEl.remove();
  }
}
