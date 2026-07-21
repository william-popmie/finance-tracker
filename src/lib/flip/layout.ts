import { Direction } from "./types";
import type { Point, Rect } from "./types";

export interface LayoutOptions {
  /** Page aspect, width / height. */
  pageRatio: number;
  maxPageWidth: number;
}

/**
 * Where the book sits on screen, and the mapping between screen space and the
 * page space `FlipCalculation` works in.
 *
 * There is deliberately no portrait mode: narrow viewports get a scaled-down
 * spread. That keeps `pos` meaning "sheets turned" at every size, so no stop
 * list has to be recomputed when the window resizes.
 */
export class BookLayout {
  /** Width of a single page. */
  pageWidth = 1;
  /** Height of the spread. */
  height = 1;
  /** Left edge of the spread, relative to the mount. */
  left = 0;
  /** Top edge of the spread, relative to the mount. */
  top = 0;
  /** Full spread width (two pages). */
  width = 2;
  /** x of the spine, relative to the mount. */
  spineX = 1;

  measure(hostWidth: number, hostHeight: number, options: LayoutOptions): void {
    let pageWidth = Math.min(hostWidth / 2, options.maxPageWidth);
    let pageHeight = pageWidth / options.pageRatio;

    if (pageHeight > hostHeight) {
      pageHeight = hostHeight;
      pageWidth = pageHeight * options.pageRatio;
    }

    // A hidden or pre-layout mount reports zero. Clamping here stops every
    // downstream number (angles, polygons) from becoming NaN.
    pageWidth = Math.max(1, pageWidth);
    pageHeight = Math.max(1, pageHeight);

    this.pageWidth = pageWidth;
    this.height = pageHeight;
    this.width = pageWidth * 2;
    this.left = hostWidth / 2 - pageWidth;
    this.top = hostHeight / 2 - pageHeight / 2;
    this.spineX = this.left + pageWidth;
  }

  /** Screen rect of one half of the spread. */
  slotRect(slot: "left" | "right"): Rect {
    return {
      left: slot === "left" ? this.left : this.spineX,
      top: this.top,
      width: this.pageWidth,
      height: this.height,
    };
  }

  /**
   * Page space -> mount space.
   *
   * BACK runs in a MIRRORED page space: x = 0 is the spine for both directions,
   * growing outward. That mirror is what lets a backward turn reuse the same
   * start -> dest path as a forward one and still swing the other way — do not
   * "fix" it by reversing time as well, or the two cancel out.
   */
  toGlobal(pos: Point, direction: Direction): Point {
    const x =
      direction === Direction.Forward
        ? pos.x + this.left + this.width / 2
        : this.width / 2 - pos.x + this.left;
    return { x, y: pos.y + this.top };
  }

  /** Mount space -> page space (inverse of `toGlobal`). */
  toPage(pos: Point, direction: Direction): Point {
    const x =
      direction === Direction.Forward
        ? pos.x - this.left - this.width / 2
        : this.width / 2 - pos.x + this.left;
    return { x, y: pos.y - this.top };
  }
}
