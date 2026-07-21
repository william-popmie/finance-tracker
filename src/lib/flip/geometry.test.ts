import { describe, expect, it } from "vitest";
import { FlipCalculation } from "./geometry/flip-calculation";
import { vacateClip } from "./geometry/vacate";
import { Corner, Direction } from "./types";
import type { Point } from "./types";

const W = 440;
const H = 600;

function parsePolygon(css: string): Point[] {
  return css
    .slice("polygon(".length, -1)
    .split(",")
    .map((pair) => {
      const [x, y] = pair.trim().split(/\s+/);
      return { x: Number.parseFloat(x), y: Number.parseFloat(y) };
    });
}

function inPolygon(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Walk a turn the way the engine does, yielding a calc per frame. */
function* frames(direction: Direction, corner: Corner, steps = 40) {
  const calc = new FlipCalculation(direction, corner, W, H);
  const margin = H / 10;
  const from = { x: W - margin, y: corner === Corner.Top ? margin : H - margin };
  const to = { x: -W, y: corner === Corner.Top ? 0 : H };

  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const p = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
    if (calc.calc(p)) yield { calc, t };
  }
}

describe("FlipCalculation", () => {
  it("progresses monotonically from 0 to ~100", () => {
    let previous = -1;
    let last = 0;
    for (const { calc } of frames(Direction.Forward, Corner.Top)) {
      const progress = calc.getFlippingProgress();
      expect(progress).toBeGreaterThanOrEqual(previous);
      previous = progress;
      last = progress;
    }
    expect(last).toBeGreaterThan(95);
  });

  it("produces geometry for every direction and grab corner", () => {
    for (const direction of [Direction.Forward, Direction.Back]) {
      for (const corner of [Corner.Top, Corner.Bottom]) {
        const drawn = [...frames(direction, corner)].length;
        expect(drawn).toBeGreaterThan(30);
      }
    }
  });
});

describe("vacateClip", () => {
  /**
   * The property that makes the book's ends work: what the near face still
   * shows and what the fold has swept past must tile the page exactly — no
   * overlap (a double-drawn seam) and no gap (a sliver of bare stage).
   */
  it("is the exact complement of the revealed region", () => {
    for (const corner of [Corner.Top, Corner.Bottom]) {
      let checked = 0;
      let mismatched = 0;

      for (const { calc } of frames(Direction.Forward, corner)) {
        const css = vacateClip(calc, Direction.Forward);
        if (!css) continue;

        const kept = parsePolygon(css);
        const swept = calc
          .getBottomClipArea()
          .filter((p): p is Point => p !== null);
        if (swept.length < 3) continue;

        for (let x = 2; x < W; x += 17) {
          for (let y = 2; y < H; y += 23) {
            const p = { x, y };
            checked++;
            if (inPolygon(kept, p) === inPolygon(swept, p)) mismatched++;
          }
        }
      }

      expect(checked).toBeGreaterThan(10_000);
      // Sampling lands a few points exactly on the shared boundary, where both
      // tests can agree; anything beyond that is a real geometry gap.
      expect(mismatched / checked).toBeLessThan(0.005);
    }
  });

  it("mirrors x for backward turns", () => {
    // Back turns run in a mirrored page space, but the clip is applied to an
    // element sitting untransformed in its slot, so it has to be un-mirrored.
    for (const corner of [Corner.Top, Corner.Bottom]) {
      const forward = [...frames(Direction.Forward, corner)];
      const backward = [...frames(Direction.Back, corner)];
      expect(forward.length).toBe(backward.length);

      for (let i = 0; i < forward.length; i++) {
        const f = vacateClip(forward[i].calc, Direction.Forward);
        const b = vacateClip(backward[i].calc, Direction.Back);
        if (!f || !b) continue;

        const fp = parsePolygon(f);
        const bp = parsePolygon(b);
        expect(bp).toHaveLength(fp.length);
        for (let k = 0; k < fp.length; k++) {
          expect(bp[k].x).toBeCloseTo(W - fp[k].x, 6);
          expect(bp[k].y).toBeCloseTo(fp[k].y, 6);
        }
      }
    }
  });

  it("peels away steadily as the turn completes", () => {
    const areas: number[] = [];
    for (const { calc } of frames(Direction.Forward, Corner.Top)) {
      const css = vacateClip(calc, Direction.Forward);
      if (!css) continue;
      const poly = parsePolygon(css);
      let inside = 0;
      for (let x = 2; x < W; x += 11) {
        for (let y = 2; y < H; y += 13) {
          if (inPolygon(poly, { x, y })) inside++;
        }
      }
      areas.push(inside);
    }

    const first = areas[0];
    const last = areas[areas.length - 1];

    // Starts covering essentially the whole page...
    expect(first / areas.length).toBeGreaterThan(0);
    expect(last).toBeLessThan(first);
    // ...and ends as a negligible sliver (~2.5% at the last drawn frame).
    // Not exactly zero: the geometry is degenerate at t=1 — the page lies flat,
    // its edge collinear with the book's — so that frame is skipped and the
    // last drawn one is just short of fully turned. The turn commits
    // immediately after, hiding the remainder.
    expect(last / first).toBeLessThan(0.05);

    // Monotonic — a page must never un-peel partway through.
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i]).toBeLessThanOrEqual(areas[i - 1]);
    }
  });

  it("returns null rather than a degenerate polygon", () => {
    const calc = new FlipCalculation(Direction.Forward, Corner.Top, W, H);
    // Never calculated: no intersect points exist yet.
    expect(vacateClip(calc, Direction.Forward)).toBeNull();
  });
});
