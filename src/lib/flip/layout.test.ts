import { describe, expect, it } from "vitest";
import { BookLayout } from "./layout";
import { DEFAULT_OPTIONS } from "./options";
import { Direction } from "./types";

const OPTS = {
  pageRatio: DEFAULT_OPTIONS.pageRatio,
  maxPageWidth: DEFAULT_OPTIONS.maxPageWidth,
};

function layoutOf(w: number, h: number): BookLayout {
  const l = new BookLayout();
  l.measure(w, h, OPTS);
  return l;
}

describe("measure", () => {
  it("fits two pages side by side and centres them", () => {
    const l = layoutOf(800, 620);
    expect(l.pageWidth).toBe(400);
    expect(l.width).toBe(800);
    expect(l.left).toBe(0);
    expect(l.spineX).toBe(400);
  });

  it("caps page width on very wide viewports", () => {
    const l = layoutOf(2000, 900);
    expect(l.pageWidth).toBe(OPTS.maxPageWidth);
    expect(l.left).toBe(1000 - OPTS.maxPageWidth);
  });

  it("shrinks to fit a short viewport rather than overflowing", () => {
    const l = layoutOf(800, 300);
    expect(l.height).toBeLessThanOrEqual(300);
    expect(l.pageWidth).toBeCloseTo(300 * OPTS.pageRatio, 6);
  });

  it("scales down on narrow viewports instead of switching to one page", () => {
    // Deliberate: no portrait mode, so `pos` keeps meaning "sheets turned" at
    // every size and no stop table has to be rebuilt on resize.
    const l = layoutOf(375, 500);
    expect(l.pageWidth).toBeCloseTo(187.5, 6);
    expect(l.width).toBeCloseTo(375, 6);
  });

  it("never produces zero or NaN for a collapsed mount", () => {
    // A hidden or pre-layout mount reports 0; unclamped, every downstream
    // angle and polygon would become NaN.
    const l = layoutOf(0, 0);
    expect(l.pageWidth).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
    expect(Number.isFinite(l.spineX)).toBe(true);
  });
});

describe("slot rects", () => {
  it("splits the spread at the spine", () => {
    const l = layoutOf(800, 620);
    expect(l.slotRect("left")).toMatchObject({ left: 0, width: 400 });
    expect(l.slotRect("right")).toMatchObject({ left: 400, width: 400 });
  });
});

describe("page-space mapping", () => {
  const l = layoutOf(800, 620);

  it("round-trips both directions", () => {
    for (const direction of [Direction.Forward, Direction.Back]) {
      for (const p of [
        { x: 0, y: 0 },
        { x: 123, y: 456 },
        { x: -200, y: 50 },
      ]) {
        const back = l.toPage(l.toGlobal(p, direction), direction);
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it("puts the spine at page x=0 for both directions", () => {
    expect(l.toGlobal({ x: 0, y: 0 }, Direction.Forward).x).toBeCloseTo(
      l.spineX,
      6
    );
    expect(l.toGlobal({ x: 0, y: 0 }, Direction.Back).x).toBeCloseTo(
      l.spineX,
      6
    );
  });

  it("mirrors backward page space", () => {
    // This mirror is what lets a backward turn reuse the same start->dest path
    // as a forward one and still swing the other way. Reversing time as well
    // would cancel it out.
    const forward = l.toGlobal({ x: 100, y: 0 }, Direction.Forward);
    const backward = l.toGlobal({ x: 100, y: 0 }, Direction.Back);
    expect(forward.x - l.spineX).toBeCloseTo(l.spineX - backward.x, 6);
  });
});
