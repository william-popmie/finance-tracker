/**
 * Pure geometry helpers.
 *
 * Ported verbatim from StPageFlip (`page-flip`, MIT) — `src/Helper.ts`.
 * Copyright (c) Nodlik. Kept faithful on purpose: the soft curl is this maths,
 * and drifting from it would change a look the user has already signed off.
 *
 * Only the single-flip *controller* around it was replaced; nothing here has
 * any state, which is precisely why many turns can be in the air at once.
 */

import type { Point, Rect, Segment } from "../types";

export function distance(p1: Point | null, p2: Point | null): number {
  if (p1 === null || p2 === null) return Infinity;
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

export function angleBetweenLines(line1: Segment, line2: Segment): number {
  const A1 = line1[0].y - line1[1].y;
  const A2 = line2[0].y - line2[1].y;
  const B1 = line1[1].x - line1[0].x;
  const B2 = line2[1].x - line2[0].x;

  return Math.acos(
    (A1 * A2 + B1 * B2) /
      (Math.sqrt(A1 * A1 + B1 * B1) * Math.sqrt(A2 * A2 + B2 * B2))
  );
}

export function pointInRect(rect: Rect, pos: Point | null): Point | null {
  if (pos === null) return null;
  if (
    pos.x >= rect.left &&
    pos.x <= rect.width + rect.left &&
    pos.y >= rect.top &&
    pos.y <= rect.top + rect.height
  ) {
    return pos;
  }
  return null;
}

/** Rotate `point` by `angle` radians, then translate by `origin`. */
export function rotatePoint(point: Point, origin: Point, angle: number): Point {
  return {
    x: point.x * Math.cos(angle) + point.y * Math.sin(angle) + origin.x,
    y: point.y * Math.cos(angle) - point.x * Math.sin(angle) + origin.y,
  };
}

/**
 * Clamp `limited` to a circle of `radius` around `center`. Returns the point
 * unchanged if already inside, otherwise the intersection with the circle.
 */
export function limitPointToCircle(
  center: Point,
  radius: number,
  limited: Point
): Point {
  if (distance(center, limited) <= radius) return limited;

  const a = center.x;
  const b = center.y;
  const n = limited.x;
  const m = limited.y;

  let x =
    Math.sqrt(
      (Math.pow(radius, 2) * Math.pow(a - n, 2)) /
        (Math.pow(a - n, 2) + Math.pow(b - m, 2))
    ) + a;
  if (limited.x < 0) x *= -1;

  let y = ((x - a) * (b - m)) / (a - n) + b;
  if (a - n + b === 0) y = radius;

  return { x, y };
}

/** Intersection of two segments, or null if it falls outside `bounds`. */
export function intersectSegments(
  bounds: Rect,
  one: Segment,
  two: Segment
): Point | null {
  return pointInRect(bounds, intersectLines(one, two));
}

/**
 * Intersection of the infinite lines through two segments.
 *
 * Throws "Segment included" when the lines are collinear — the caller
 * (`FlipCalculation.calc`) treats that as "this frame has no valid geometry"
 * and skips the draw. That happens at exactly t=1 of a turn, where the page
 * lies flat and its top edge coincides with the book's top edge.
 */
export function intersectLines(one: Segment, two: Segment): Point | null {
  const A1 = one[0].y - one[1].y;
  const A2 = two[0].y - two[1].y;
  const B1 = one[1].x - one[0].x;
  const B2 = two[1].x - two[0].x;
  const C1 = one[0].x * one[1].y - one[1].x * one[0].y;
  const C2 = two[0].x * two[1].y - two[1].x * two[0].y;

  const det1 = A1 * C2 - A2 * C1;
  const det2 = B1 * C2 - B2 * C1;

  const x = -((C1 * B2 - C2 * B1) / (A1 * B2 - A2 * B1));
  const y = -((A1 * C2 - A2 * C1) / (A1 * B2 - A2 * B1));

  if (isFinite(x) && isFinite(y)) return { x, y };
  if (Math.abs(det1 - det2) < 0.1) throw new Error("Segment included");

  return null;
}
