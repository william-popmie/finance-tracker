import type { Point } from "../types";

/**
 * Build a CSS `polygon(...)` value, skipping null vertices.
 *
 * Nulls are normal: `FlipCalculation`'s intersect points are null whenever the
 * fold does not cross that edge yet, and the clip areas include them
 * positionally. Dropping them is what the original renderer did too.
 */
export function toPolygon(points: readonly (Point | null)[]): string {
  const parts: string[] = [];
  for (const p of points) {
    if (p) parts.push(`${p.x}px ${p.y}px`);
  }
  return `polygon(${parts.join(",")})`;
}

/** Map every non-null point, preserving nulls. */
export function mapPoints(
  points: readonly (Point | null)[],
  fn: (p: Point) => Point
): (Point | null)[] {
  return points.map((p) => (p ? fn(p) : null));
}
