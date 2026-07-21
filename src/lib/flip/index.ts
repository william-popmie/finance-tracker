/**
 * A soft-curl page-flip engine with genuinely concurrent turns.
 *
 * Replaces StPageFlip, which animates one page at a time by construction. The
 * curl geometry here is ported from that library (MIT) — see `geometry/` — but
 * the controller around it is ours, which is what allows several leaves to be
 * in the air at once.
 *
 * Usage:
 *   const book = new FlipBook(mountEl);
 *   const off = book.on("change", (s) => ...);
 *   book.next(); book.goToSide(3);
 *   off(); book.destroy();
 *
 * The mount's `.book-page` children are the pages, in order.
 */
export { FlipBook } from "./flip-book";
export type { ChangeListener } from "./flip-book";

export { DEFAULT_OPTIONS, easeInOutQuad, resolveOptions } from "./options";
export type { Easing, FlipOptions } from "./options";

export { BookLayout } from "./layout";
export { SheetModel } from "./model";
export type { TurnSequence, TurnStep } from "./model";

export { Corner, Direction } from "./types";
export type {
  BookState,
  Point,
  Rect,
  RectPoints,
  Roles,
  Sheet,
  SheetKind,
  Side,
} from "./types";

// Extension points. Implement these to swap how turns or shadows are drawn.
export type {
  FlightView,
  SheetRenderer,
  SheetRendererFactory,
} from "./renderers/types";
export type {
  ShadowRenderer,
  ShadowRendererFactory,
  ShadowState,
} from "./shadows/types";
export { DEFAULT_RESTING_SHADOW } from "./shadows/resting";
