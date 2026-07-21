import { describe, expect, it } from "vitest";
import { SheetModel } from "./model";
import { Direction } from "./types";
import type { Side } from "./types";

function modelWith(sideCount: number): SheetModel {
  const m = new SheetModel();
  m.setSides(
    Array.from({ length: sideCount }, () => ({
      el: null as unknown as HTMLElement,
      kind: "soft",
    })) as Side[]
  );
  return m;
}

describe("landing sequences", () => {
  const m = modelWith(20); // 10 sheets
  const caps = [1, 2, 6, 14];

  it("always ends exactly on the target", () => {
    // The alternative — riffling forward from the current position and snapping
    // the remainder — makes content visibly change after the animation ends.
    for (const cap of caps) {
      for (let from = 0; from <= m.sheetCount; from++) {
        for (let to = 0; to <= m.sheetCount; to++) {
          if (from === to) continue;
          const seq = m.landingSequence(from, to, cap);
          expect(seq.steps[seq.steps.length - 1].landPos).toBe(to);
        }
      }
    }
  });

  it("only ever turns sheets that exist", () => {
    for (const cap of caps) {
      for (let from = 0; from <= m.sheetCount; from++) {
        for (let to = 0; to <= m.sheetCount; to++) {
          if (from === to) continue;
          for (const step of m.landingSequence(from, to, cap).steps) {
            expect(m.hasSheet(step.sheetIdx)).toBe(true);
            expect(step.landPos).toBeGreaterThanOrEqual(0);
            expect(step.landPos).toBeLessThanOrEqual(m.sheetCount);
          }
        }
      }
    }
  });

  it("caps how many turns animate on a long jump", () => {
    expect(m.landingSequence(0, 10, 6).steps).toHaveLength(6);
    expect(m.landingSequence(0, 3, 6).steps).toHaveLength(3);
  });

  it("moves one step at a time, in order", () => {
    const seq = m.landingSequence(0, 10, 6);
    expect(seq.direction).toBe(Direction.Forward);
    const lands = seq.steps.map((s) => s.landPos);
    expect(lands).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("runs backwards symmetrically", () => {
    const seq = m.landingSequence(10, 0, 6);
    expect(seq.direction).toBe(Direction.Back);
    expect(seq.steps.map((s) => s.landPos)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("does nothing when already there, or out of range", () => {
    expect(m.landingSequence(3, 3, 6).steps).toHaveLength(0);
    // Clamped, so a target past the end still lands on the last position.
    expect(m.landingSequence(9, 999, 6).steps.at(-1)?.landPos).toBe(10);
    expect(m.landingSequence(1, -999, 6).steps.at(-1)?.landPos).toBe(0);
  });
});

describe("rapid bursts", () => {
  it("queues consecutive sheets and stops at the end", () => {
    // Mirrors FlipBook.turn(), which extends from the projected position so a
    // burst does not re-turn the same sheet.
    const m = modelWith(20);
    const turned: number[] = [];
    let projected = 0;

    for (let i = 0; i < m.sheetCount + 4; i++) {
      const sheetIdx = m.sheetIndexFor(projected, Direction.Forward);
      const target = projected + 1;
      if (target > m.sheetCount || !m.hasSheet(sheetIdx)) continue;
      turned.push(sheetIdx);
      projected = target;
    }

    expect(turned).toEqual([...Array(m.sheetCount).keys()]);
    expect(projected).toBe(m.sheetCount);
  });

  it("cannot turn back past the front cover", () => {
    const m = modelWith(20);
    expect(m.hasSheet(m.sheetIndexFor(0, Direction.Back))).toBe(false);
  });
});
