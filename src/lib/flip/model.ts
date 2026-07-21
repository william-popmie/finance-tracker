import { Direction } from "./types";
import type { Roles, Sheet, Side } from "./types";

/** One turn in a navigation sequence. */
export interface TurnStep {
  /** Which sheet rotates. */
  sheetIdx: number;
  /** The position the book is at once this turn commits. */
  landPos: number;
}

export interface TurnSequence {
  direction: Direction;
  steps: TurnStep[];
}

/**
 * The book as sides and sheets. Pure — no DOM, no timing, no rendering.
 *
 * `pos` is the number of sheets turned, so it doubles as the index of the next
 * sheet to turn forward. Everything else is derived from it, which is why there
 * is no stop table to keep in sync (the old StPageFlip shell had one, and
 * keeping it aligned across orientation changes was a recurring source of bugs).
 */
export class SheetModel {
  sides: Side[] = [];
  sheets: Sheet[] = [];
  pos = 0;

  /**
   * Pair consecutive sides into sheets. Expects an even count — the caller is
   * responsible for padding, because inventing a page is a DOM concern.
   */
  setSides(sides: Side[]): void {
    this.sides = sides;
    this.sheets = [];
    for (let k = 0; 2 * k + 1 < sides.length; k++) {
      // A sheet's kind comes from its front side; that is the face carrying
      // `data-density` in the markup.
      this.sheets.push({ f: 2 * k, b: 2 * k + 1, kind: sides[2 * k].kind });
    }
    this.pos = 0;
  }

  get sheetCount(): number {
    return this.sheets.length;
  }

  get sideCount(): number {
    return this.sides.length;
  }

  /** Side index in the left slot at `pos`, or -1 when the book is closed shut. */
  leftSideIndex(pos: number = this.pos): number {
    const i = 2 * pos - 1;
    return i >= 0 && i < this.sides.length ? i : -1;
  }

  /** Side index in the right slot at `pos`, or -1 when fully turned. */
  rightSideIndex(pos: number = this.pos): number {
    const i = 2 * pos;
    return i >= 0 && i < this.sides.length ? i : -1;
  }

  /**
   * The position at which a given side becomes visible.
   * Reproduces the old shell's `stopIdxForLeaf` exactly, so chapter tabs and
   * page-number jumps keep their existing meaning.
   */
  positionOfSide(sideIndex: number): number {
    return this.clampPosition(Math.floor((sideIndex + 1) / 2));
  }

  /**
   * The side whose number is shown in the counter: the left page normally, and
   * the lone right page when the book is shut.
   */
  leadingSideIndex(pos: number = this.pos): number {
    if (pos <= 0) return 0;
    return Math.min(2 * pos - 1, Math.max(0, this.sides.length - 1));
  }

  clampPosition(pos: number): number {
    if (!Number.isFinite(pos)) return this.pos;
    return Math.max(0, Math.min(this.sheetCount, Math.trunc(pos)));
  }

  /**
   * The three sides a turn of `sheet` involves. Mirrors page-flip's
   * `getFlippingPage`/`getBottomPage` (landscape branch).
   *
   * LEAD is the sheet's FAR face — the underside of the corner you lift, and
   * the face that ends up in the destination slot. REST is the near face, still
   * flat in its slot. Swapping these makes the flap show the page you are
   * turning away from until the flip commits.
   */
  roles(direction: Direction, sheet: Sheet): Roles {
    return direction === Direction.Forward
      ? { leadIdx: sheet.b, restIdx: sheet.f, bottomIdx: sheet.f + 2 }
      : { leadIdx: sheet.f, restIdx: sheet.b, bottomIdx: sheet.b - 2 };
  }

  sideAt(index: number): Side | null {
    return index >= 0 && index < this.sides.length ? this.sides[index] : null;
  }

  /** The sheet that must turn to move from `pos` in `direction`. */
  sheetIndexFor(pos: number, direction: Direction): number {
    return direction === Direction.Forward ? pos : pos - 1;
  }

  hasSheet(index: number): boolean {
    return index >= 0 && index < this.sheetCount;
  }

  /**
   * Turns to play to get from `from` to `to`, capped at `cap` animations.
   *
   * The landing sequence is synthesized BACKWARD from the target so the last
   * turn arrives exactly there. That matters for long jumps: the single content
   * discontinuity then sits under the FIRST flip and is uncovered progressively,
   * exactly as a normal turn reveals what is beneath it. Riffling forward from
   * the current position and snapping the remainder at the end instead makes the
   * content visibly change after the animation has finished.
   */
  landingSequence(from: number, to: number, cap: number): TurnSequence {
    const target = this.clampPosition(to);
    const start = this.clampPosition(from);
    const delta = target - start;

    if (delta === 0) return { direction: Direction.Forward, steps: [] };

    const forward = delta > 0;
    const stride = forward ? 1 : -1;
    const count = Math.min(Math.abs(delta), Math.max(1, Math.trunc(cap)));

    const steps: TurnStep[] = [];
    for (let i = 0; i < count; i++) {
      const landPos = target - (count - 1 - i) * stride;
      steps.push({
        sheetIdx: forward ? landPos - 1 : landPos,
        landPos,
      });
    }

    return {
      direction: forward ? Direction.Forward : Direction.Back,
      steps,
    };
  }
}
