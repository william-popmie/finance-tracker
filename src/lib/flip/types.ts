/**
 * Shared vocabulary for the flip engine.
 *
 * THE MODEL, in one place, because every module depends on getting it right:
 *
 *   SIDE   one page of content, one DOM element. Covers are ordinary sides.
 *   SHEET  a physical leaf — the pair of sides (2k, 2k+1).
 *   pos    the number of sheets TURNED.
 *            left slot  = sides[2*pos - 1]   (none at pos 0)
 *            right slot = sides[2*pos]       (none when fully turned)
 *
 * A turn always rotates a SHEET, never a side. An earlier "one page = one flip"
 * model was physically incoherent — a page turned to the left slot still showed
 * its front — and every attempt to patch that around the covers just relocated
 * the bug.
 */

/** Which way a sheet is being turned. */
export const Direction = { Forward: 0, Back: 1 } as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** Which corner of the page the turn pivots from (drag can grab either). */
export const Corner = { Top: "top", Bottom: "bottom" } as const;
export type Corner = (typeof Corner)[keyof typeof Corner];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The four corners of the turning page, in page space. */
export interface RectPoints {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
}

export type Segment = [Point, Point];

/**
 * How a sheet behaves when turned. Read from `data-density` on the side element.
 *
 * Today both kinds render soft — hardcovers were removed after repeated bugs.
 * The distinction is kept because re-introducing a rigid renderer is a planned
 * rework, and `data-density="hard"` already exists in the markup.
 */
export type SheetKind = "soft" | "hard";

export interface Side {
  el: HTMLElement;
  kind: SheetKind;
}

/** A physical leaf: `f` is the front side index, `b` the back. */
export interface Sheet {
  f: number;
  b: number;
  kind: SheetKind;
}

/**
 * The three sides a single turn involves.
 *
 * LEAD is the lifted flap: the sheet's FAR face — what you'd physically see on
 * the underside of the corner you just picked up. Getting this backwards makes
 * the flap show the page you're turning away from until the flip commits.
 *
 * REST is the un-turned remainder, still lying flat in its slot. LEAD and REST
 * are the two faces of the same sheet.
 *
 * BOTTOM is the side revealed underneath, in the neighbouring sheet. It is
 * absent at the first and last sheets — there you turn onto bare stage.
 */
export interface Roles {
  leadIdx: number;
  restIdx: number;
  bottomIdx: number;
}

/** What consumers observe. `page` is 1-based for display. */
export interface BookState {
  /** Sheets turned. */
  pos: number;
  /** Total sheets. */
  sheets: number;
  /** Total sides (pages). */
  sides: number;
  /** 1-based number of the leading visible page. */
  page: number;
}
