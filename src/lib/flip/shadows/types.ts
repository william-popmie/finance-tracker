import type { BookLayout } from "../layout";
import type { Direction, Point, RectPoints } from "../types";

/**
 * Everything a shadow renderer needs for one frame, derived from the flight's
 * geometry. Deliberately expressed in page space (plus the layout to project
 * with) rather than as finished CSS, so an alternative implementation is free
 * to render however it likes — canvas, SVG filters, a different gradient stack.
 */
export interface ShadowState {
  /** Where the fold meets the page edge, in page space. Null very early on. */
  start: Point | null;
  /** Fold angle in radians, already offset by 3PI/2 for rendering. */
  angle: number;
  /** 0 at the start of a turn, 100 when fully turned. */
  progress: number;
  /** Width of the shadow band, scaled with progress. */
  width: number;
  /** Opacity at this progress. */
  opacity: number;
  direction: Direction;
  /** The turning page's four corners, in page space. */
  pageRect: RectPoints;
  /** Base z-index for this flight. */
  z: number;
}

/**
 * SEAM: the shadow engine.
 *
 * One instance per in-flight turn, so concurrent turns each get their own
 * shadows — the singleton shadow elements in StPageFlip are a large part of why
 * it could only animate one page at a time.
 *
 * To replace the look, implement this and point `options.createShadowRenderer`
 * at the new factory. Nothing else in the engine needs to change.
 */
export interface ShadowRenderer {
  draw(state: ShadowState, layout: BookLayout): void;
  destroy(): void;
}

export type ShadowRendererFactory = (
  host: HTMLElement,
  options: { maxOpacity: number }
) => ShadowRenderer;
