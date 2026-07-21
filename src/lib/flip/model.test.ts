import { describe, expect, it } from "vitest";
import { SheetModel } from "./model";
import { Direction } from "./types";
import type { Side } from "./types";

/** Sides without a DOM — the model never touches `el`. */
function sides(count: number): Side[] {
  return Array.from({ length: count }, () => ({
    el: null as unknown as HTMLElement,
    kind: "soft" as const,
  }));
}

function modelWith(sideCount: number): SheetModel {
  const m = new SheetModel();
  m.setSides(sides(sideCount));
  return m;
}

describe("sheet pairing", () => {
  it("pairs consecutive sides into sheets", () => {
    const m = modelWith(20);
    expect(m.sheetCount).toBe(10);
    expect(m.sheets[0]).toMatchObject({ f: 0, b: 1 });
    expect(m.sheets[9]).toMatchObject({ f: 18, b: 19 });
  });

  it("drops a trailing unpaired side (callers must pad)", () => {
    // FlipBook pads before this point; the model itself stays pure. Guarding it
    // here so the padding contract is explicit rather than assumed.
    expect(modelWith(19).sheetCount).toBe(9);
  });

  it("handles an empty book", () => {
    const m = modelWith(0);
    expect(m.sheetCount).toBe(0);
    expect(m.leftSideIndex(0)).toBe(-1);
    expect(m.rightSideIndex(0)).toBe(-1);
  });
});

describe("resting slots", () => {
  const m = modelWith(20);

  it("has no left page when shut, no right page when fully turned", () => {
    expect(m.leftSideIndex(0)).toBe(-1);
    expect(m.rightSideIndex(0)).toBe(0);
    expect(m.leftSideIndex(10)).toBe(19);
    expect(m.rightSideIndex(10)).toBe(-1);
  });

  it("shows both pages at every open spread", () => {
    for (let pos = 1; pos < m.sheetCount; pos++) {
      expect(m.leftSideIndex(pos)).toBe(2 * pos - 1);
      expect(m.rightSideIndex(pos)).toBe(2 * pos);
    }
  });
});

describe("turn roles", () => {
  const m = modelWith(20);

  it("lifts the sheet's FAR face, never the one lying flat", () => {
    // The bug this guards: using the near face made the flap show the page you
    // were turning away from until the flip committed.
    for (let pos = 0; pos < m.sheetCount; pos++) {
      const fwd = m.roles(Direction.Forward, m.sheets[pos]);
      expect(fwd.restIdx).toBe(m.rightSideIndex(pos));
      expect(fwd.leadIdx).not.toBe(fwd.restIdx);
      // LEAD lands in the destination slot.
      expect(fwd.leadIdx).toBe(2 * (pos + 1) - 1);
    }
    for (let pos = m.sheetCount; pos > 0; pos--) {
      const back = m.roles(Direction.Back, m.sheets[pos - 1]);
      expect(back.restIdx).toBe(m.leftSideIndex(pos));
      expect(back.leadIdx).not.toBe(back.restIdx);
      expect(back.leadIdx).toBe(2 * (pos - 1));
    }
  });

  it("swaps lead and rest when the turn reverses", () => {
    for (const sheet of m.sheets) {
      const f = m.roles(Direction.Forward, sheet);
      const b = m.roles(Direction.Back, sheet);
      expect(f.leadIdx).toBe(b.restIdx);
      expect(f.restIdx).toBe(b.leadIdx);
    }
  });

  it("has a revealed page exactly when the turn is not landing shut", () => {
    // Where this is false, the vacate clip takes over — so the two must agree.
    const inRange = (i: number) => i >= 0 && i < m.sideCount;

    for (let pos = 0; pos < m.sheetCount; pos++) {
      const { bottomIdx } = m.roles(Direction.Forward, m.sheets[pos]);
      expect(inRange(bottomIdx)).toBe(pos + 1 < m.sheetCount);
    }
    for (let pos = m.sheetCount; pos > 0; pos--) {
      const { bottomIdx } = m.roles(Direction.Back, m.sheets[pos - 1]);
      expect(inRange(bottomIdx)).toBe(pos - 1 > 0);
    }
  });
});

describe("page numbering", () => {
  it("reproduces the old shell's leaf-to-stop mapping", () => {
    // The pre-port shell walked a `stops` array ([0,1,3,5,…] in landscape) to
    // find the spread containing a leaf. Chapter tabs and the page input are
    // still expressed in those leaf numbers, so this mapping must not drift.
    const m = modelWith(20);
    const stops = [0];
    for (let i = 1; i < m.sideCount; i += 2) stops.push(i);

    const oldStopIdx = (leaf: number) => {
      let idx = 0;
      for (let i = 0; i < stops.length; i++) {
        if (stops[i] <= leaf) idx = i;
        else break;
      }
      return idx;
    };

    for (let leaf = 0; leaf < m.sideCount; leaf++) {
      expect(m.positionOfSide(leaf)).toBe(oldStopIdx(leaf));
    }
  });

  it("names the leading visible page", () => {
    const m = modelWith(20);
    expect(m.leadingSideIndex(0)).toBe(0);
    expect(m.leadingSideIndex(1)).toBe(1);
    expect(m.leadingSideIndex(2)).toBe(3);
    expect(m.leadingSideIndex(10)).toBe(19);
  });

  it("clamps out-of-range positions", () => {
    const m = modelWith(20);
    expect(m.clampPosition(-5)).toBe(0);
    expect(m.clampPosition(999)).toBe(10);
    expect(m.clampPosition(Number.NaN)).toBe(m.pos);
  });
});
