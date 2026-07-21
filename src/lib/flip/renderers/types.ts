import type { FlipCalculation } from "../geometry/flip-calculation";
import type { BookLayout } from "../layout";
import type { FlipOptions } from "../options";
import type { Direction, Roles, Sheet } from "../types";

/**
 * The read-only view of an in-flight turn that a renderer draws from.
 *
 * The Flight owns the DOM and the timing; the renderer owns only the painting.
 * That split is what lets a future rigid-sheet renderer reuse the whole
 * scheduler, drag handling and commit logic unchanged.
 */
export interface FlightView {
  readonly calc: FlipCalculation;
  readonly direction: Direction;
  readonly sheet: Sheet;
  readonly roles: Roles;
  readonly layout: BookLayout;
  readonly options: FlipOptions;
  /** Element the flight draws into. */
  readonly host: HTMLElement;
  /**
   * The lifted flap — a CLONE of the lead side.
   *
   * It must be a clone: the original stays flat in the composite underneath so
   * the un-turned remainder keeps rendering. Clipping the live element instead
   * makes everything except the fold disappear the instant a turn starts.
   */
  readonly leadEl: HTMLElement;
  /** The turning sheet's near face, resting in its slot. May be absent. */
  readonly restEl: HTMLElement | null;
  /** The side revealed underneath. Absent at the first and last sheets. */
  readonly bottomEl: HTMLElement | null;
  /** Base z-index; renderers layer upward from here. */
  readonly z: number;
  /**
   * Whether `restEl` currently occupies the slot the static composite just drew
   * it into. Guards against a concurrent turn styling a hidden side into view.
   */
  restInSlot(): boolean;
}

/**
 * SEAM: how a turning sheet is drawn.
 *
 * One instance per in-flight turn. The constructor does the "mount" work, and
 * `destroy` the teardown, so a renderer can own whatever DOM it needs without
 * the Flight knowing about it.
 *
 * Re-introducing hardcovers means adding a rigid implementation of this plus a
 * line in `registry.ts`. The scheduler, drag controller and commit path do not
 * change. (When that happens, re-read invariant 5 in the plan: a non-`none`
 * filter anywhere above a 3D subtree forces `transform-style: flat` and turns
 * `rotateY` into a flat horizontal stretch.)
 */
export interface SheetRenderer {
  draw(): void;
  destroy(): void;
}

export type SheetRendererFactory = (flight: FlightView) => SheetRenderer;
