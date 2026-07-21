import { Corner, Direction } from "../types";
import type { Point } from "../types";
import type { FlipCalculation } from "./flip-calculation";
import { toPolygon } from "./polygon";

/**
 * The region of the turning sheet's near face that the fold has NOT swept past.
 *
 * WHY THIS EXISTS
 * Mid-book, the vacated area is covered by the page revealed underneath
 * (`getBottomClipArea`), so the near face can be drawn whole and nobody notices.
 * At the FIRST and LAST sheets there is no page underneath — you are opening
 * onto, or closing against, bare stage — so nothing covers it and the near face
 * would sit there fully intact until the flip committed, reading as a stray page
 * lying flat. Clipping it to this region makes it peel away instead.
 *
 * This is the exact complement of `getBottomClipArea` within the page: the same
 * fold boundary, closed toward the spine instead of the outer edge. Verified by
 * point sampling in `geometry.test.ts`.
 *
 * Page space for BACK turns is mirrored (x = 0 is always the spine), but this
 * polygon is applied to an element sitting in its slot untransformed, so x has
 * to be un-mirrored back into element-local coordinates.
 *
 * Returns null when the fold has not produced enough intersect points yet — the
 * caller should leave the page unclipped rather than collapse it to nothing.
 */
export function vacateClip(
  calc: FlipCalculation,
  direction: Direction
): string | null {
  const w = calc.pageWidth;
  const h = calc.pageHeight;
  const top = calc.getTopIntersect();
  const side = calc.getSideIntersect();
  const bottom = calc.getBottomIntersect();

  let points: (Point | null)[];

  if (side) {
    // The fold exits the outer edge, so the vacated part is a corner wedge.
    points =
      calc.corner === Corner.Top
        ? [{ x: 0, y: 0 }, top, side, { x: w, y: h }, { x: 0, y: h }]
        : [{ x: 0, y: 0 }, { x: w, y: 0 }, side, bottom, { x: 0, y: h }];
  } else {
    // The fold spans top edge to bottom edge; keep the spine-side half.
    points = [{ x: 0, y: 0 }, top, bottom, { x: 0, y: h }];
  }

  if (points.some((p) => !p)) return null;

  const resolved = points as Point[];
  const mapped =
    direction === Direction.Back
      ? resolved.map((p) => ({ x: w - p.x, y: p.y }))
      : resolved;

  return toPolygon(mapped);
}
