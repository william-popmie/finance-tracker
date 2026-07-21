/**
 * The curl geometry for ONE turning page.
 *
 * Ported verbatim from StPageFlip (`page-flip`, MIT) — `src/Flip/FlipCalculation.ts`.
 * Copyright (c) Nodlik.
 *
 * This class is the whole reason concurrent flips are possible. It is a pure
 * geometry object: give it one corner point and it yields the clip polygon, the
 * page position, the rotation angle and the shadow data. It holds no reference
 * to the book, so you can instantiate as many as there are turns in the air.
 * StPageFlip only ever animated one at a time because its *controller* held a
 * single instance — not because of anything here.
 *
 * Note the BACK direction operates in a MIRRORED page space (see
 * `BookLayout.toPage`/`toGlobal`): x = 0 is always the spine, so both
 * directions can run the same start -> dest path and still swing opposite ways.
 */

import { Corner, Direction } from "../types";
import type { Point, Rect, RectPoints, Segment } from "../types";
import {
  angleBetweenLines,
  distance,
  intersectSegments,
  limitPointToCircle,
} from "./helper";

export class FlipCalculation {
  private angle = 0;
  private position: Point | null = null;
  private rect: RectPoints | null = null;

  /** Where the fold crosses the page's top / outer / bottom edge. */
  private topIntersect: Point | null = null;
  private sideIntersect: Point | null = null;
  private bottomIntersect: Point | null = null;

  constructor(
    public readonly direction: Direction,
    public readonly corner: Corner,
    public readonly pageWidth: number,
    public readonly pageHeight: number
  ) {}

  /**
   * Recompute for a corner position, in page space.
   * Returns false when the geometry is degenerate — the caller should skip the
   * frame rather than draw garbage.
   */
  calc(localPos: Point): boolean {
    try {
      this.position = this.calcAngleAndPosition(localPos);
      this.calculateIntersectPoints(this.position);
      return true;
    } catch {
      return false;
    }
  }

  /** True once `calc` has succeeded at least once. */
  get ready(): boolean {
    return this.position !== null && this.rect !== null;
  }

  getTopIntersect(): Point | null {
    return this.topIntersect;
  }
  getSideIntersect(): Point | null {
    return this.sideIntersect;
  }
  getBottomIntersect(): Point | null {
    return this.bottomIntersect;
  }

  /** The folded flap: the region of the turning page that has lifted. */
  getFlippingClipArea(): (Point | null)[] {
    const rect = this.requireRect();
    const result: (Point | null)[] = [];
    let clipBottom = false;

    result.push(rect.topLeft);
    result.push(this.topIntersect);

    if (this.sideIntersect === null) {
      clipBottom = true;
    } else {
      result.push(this.sideIntersect);
      if (this.bottomIntersect === null) clipBottom = false;
    }

    result.push(this.bottomIntersect);

    if (clipBottom || this.corner === Corner.Bottom) result.push(rect.bottomLeft);

    return result;
  }

  /**
   * The vacated region: where the page underneath shows through.
   * `vacateClip` builds the exact complement of this for the book's ends.
   */
  getBottomClipArea(): (Point | null)[] {
    const result: (Point | null)[] = [];

    result.push(this.topIntersect);

    if (this.corner === Corner.Top) {
      result.push({ x: this.pageWidth, y: 0 });
    } else {
      if (this.topIntersect !== null) result.push({ x: this.pageWidth, y: 0 });
      result.push({ x: this.pageWidth, y: this.pageHeight });
    }

    if (this.sideIntersect !== null) {
      if (distance(this.sideIntersect, this.topIntersect) >= 10) {
        result.push(this.sideIntersect);
      }
    } else if (this.corner === Corner.Top) {
      result.push({ x: this.pageWidth, y: this.pageHeight });
    }

    result.push(this.bottomIntersect);
    result.push(this.topIntersect);

    return result;
  }

  getAngle(): number {
    return this.direction === Direction.Forward ? -this.angle : this.angle;
  }

  getRect(): RectPoints {
    return this.requireRect();
  }

  getPosition(): Point | null {
    return this.position;
  }

  /** The corner the flap hangs from, in page space. */
  getActiveCorner(): Point {
    const rect = this.requireRect();
    return this.direction === Direction.Forward ? rect.topLeft : rect.topRight;
  }

  /** 0 at the start of a turn, 100 when fully turned. */
  getFlippingProgress(): number {
    if (this.position === null) return 0;
    return Math.abs(
      ((this.position.x - this.pageWidth) / (2 * this.pageWidth)) * 100
    );
  }

  /** Where the revealed page sits, in page space. */
  getBottomPagePosition(): Point {
    if (this.direction === Direction.Back) return { x: this.pageWidth, y: 0 };
    return { x: 0, y: 0 };
  }

  getShadowStartPoint(): Point | null {
    if (this.corner === Corner.Top) return this.topIntersect;
    return this.sideIntersect !== null ? this.sideIntersect : this.topIntersect;
  }

  getShadowAngle(): number {
    const angle = angleBetweenLines(this.segmentToShadowLine(), [
      { x: 0, y: 0 },
      { x: this.pageWidth, y: 0 },
    ]);
    return this.direction === Direction.Forward ? angle : Math.PI - angle;
  }

  // ---- internals (verbatim) ------------------------------------------------

  private requireRect(): RectPoints {
    if (this.rect === null) throw new Error("FlipCalculation: calc() not run");
    return this.rect;
  }

  private calcAngleAndPosition(pos: Point): Point {
    let result = pos;
    this.updateAngleAndGeometry(result);

    if (this.corner === Corner.Top) {
      result = this.checkPositionAtCenterLine(
        result,
        { x: 0, y: 0 },
        { x: 0, y: this.pageHeight }
      );
    } else {
      result = this.checkPositionAtCenterLine(
        result,
        { x: 0, y: this.pageHeight },
        { x: 0, y: 0 }
      );
    }

    if (Math.abs(result.x - this.pageWidth) < 1 && Math.abs(result.y) < 1) {
      throw new Error("Point is too small");
    }
    return result;
  }

  private updateAngleAndGeometry(pos: Point): void {
    this.angle = this.calculateAngle(pos);
    this.rect = this.getPageRect(pos);
  }

  private calculateAngle(pos: Point): number {
    const left = this.pageWidth - pos.x + 1;
    const top =
      this.corner === Corner.Bottom ? this.pageHeight - pos.y : pos.y;

    let angle = 2 * Math.acos(left / Math.sqrt(top * top + left * left));
    if (top < 0) angle = -angle;

    const da = Math.PI - angle;
    if (!isFinite(angle) || (da >= 0 && da < 0.003)) {
      throw new Error("The G point is too small");
    }

    if (this.corner === Corner.Bottom) angle = -angle;
    return angle;
  }

  private getPageRect(localPos: Point): RectPoints {
    if (this.corner === Corner.Top) {
      return this.rectFromBasePoint(
        [
          { x: 0, y: 0 },
          { x: this.pageWidth, y: 0 },
          { x: 0, y: this.pageHeight },
          { x: this.pageWidth, y: this.pageHeight },
        ],
        localPos
      );
    }
    return this.rectFromBasePoint(
      [
        { x: 0, y: -this.pageHeight },
        { x: this.pageWidth, y: -this.pageHeight },
        { x: 0, y: 0 },
        { x: this.pageWidth, y: 0 },
      ],
      localPos
    );
  }

  private rectFromBasePoint(points: Point[], localPos: Point): RectPoints {
    return {
      topLeft: this.rotatedPoint(points[0], localPos),
      topRight: this.rotatedPoint(points[1], localPos),
      bottomLeft: this.rotatedPoint(points[2], localPos),
      bottomRight: this.rotatedPoint(points[3], localPos),
    };
  }

  private rotatedPoint(transformed: Point, start: Point): Point {
    return {
      x:
        transformed.x * Math.cos(this.angle) +
        transformed.y * Math.sin(this.angle) +
        start.x,
      y:
        transformed.y * Math.cos(this.angle) -
        transformed.x * Math.sin(this.angle) +
        start.y,
    };
  }

  private calculateIntersectPoints(pos: Point): void {
    const rect = this.requireRect();
    const bounds: Rect = {
      left: -1,
      top: -1,
      width: this.pageWidth + 2,
      height: this.pageHeight + 2,
    };

    if (this.corner === Corner.Top) {
      this.topIntersect = intersectSegments(
        bounds,
        [pos, rect.topRight],
        [
          { x: 0, y: 0 },
          { x: this.pageWidth, y: 0 },
        ]
      );
      this.sideIntersect = intersectSegments(
        bounds,
        [pos, rect.bottomLeft],
        [
          { x: this.pageWidth, y: 0 },
          { x: this.pageWidth, y: this.pageHeight },
        ]
      );
      this.bottomIntersect = intersectSegments(
        bounds,
        [rect.bottomLeft, rect.bottomRight],
        [
          { x: 0, y: this.pageHeight },
          { x: this.pageWidth, y: this.pageHeight },
        ]
      );
    } else {
      this.topIntersect = intersectSegments(
        bounds,
        [rect.topLeft, rect.topRight],
        [
          { x: 0, y: 0 },
          { x: this.pageWidth, y: 0 },
        ]
      );
      this.sideIntersect = intersectSegments(
        bounds,
        [pos, rect.topLeft],
        [
          { x: this.pageWidth, y: 0 },
          { x: this.pageWidth, y: this.pageHeight },
        ]
      );
      this.bottomIntersect = intersectSegments(
        bounds,
        [rect.bottomLeft, rect.bottomRight],
        [
          { x: 0, y: this.pageHeight },
          { x: this.pageWidth, y: this.pageHeight },
        ]
      );
    }
  }

  private checkPositionAtCenterLine(
    checked: Point,
    centerOne: Point,
    centerTwo: Point
  ): Point {
    let result = checked;

    const tmp = limitPointToCircle(centerOne, this.pageWidth, result);
    if (result !== tmp) {
      result = tmp;
      this.updateAngleAndGeometry(result);
    }

    const rad = Math.sqrt(
      Math.pow(this.pageWidth, 2) + Math.pow(this.pageHeight, 2)
    );

    const rect = this.requireRect();
    let checkOne = rect.bottomRight;
    let checkTwo = rect.topLeft;
    if (this.corner === Corner.Bottom) {
      checkOne = rect.topRight;
      checkTwo = rect.bottomLeft;
    }

    if (checkOne.x <= 0) {
      const bottomPoint = limitPointToCircle(centerTwo, rad, checkTwo);
      if (bottomPoint !== result) {
        result = bottomPoint;
        this.updateAngleAndGeometry(result);
      }
    }

    return result;
  }

  private segmentToShadowLine(): Segment {
    const first = this.getShadowStartPoint();
    const second =
      first !== this.sideIntersect && this.sideIntersect !== null
        ? this.sideIntersect
        : this.bottomIntersect;
    return [first as Point, second as Point];
  }
}
