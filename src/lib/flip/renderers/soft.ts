import { rotatePoint } from "../geometry/helper";
import { mapPoints, toPolygon } from "../geometry/polygon";
import { vacateClip } from "../geometry/vacate";
import { Direction } from "../types";
import type { Point } from "../types";
import type { ShadowRenderer } from "../shadows/types";
import type { FlightView, SheetRenderer } from "./types";

/**
 * The soft page curl — a flat clipped polygon plus a rotation, with the depth
 * coming entirely from the shadow pair.
 *
 * Ported from StPageFlip's `HTMLPage.drawSoft` (MIT). There is no mesh and no
 * 3D transform: the fold is `clip-path` and the lift is `rotate()`. Worth
 * knowing when reworking, because it means nothing here needs `perspective`.
 */
export class SoftSheetRenderer implements SheetRenderer {
  private readonly shadows: ShadowRenderer;

  constructor(private readonly flight: FlightView) {
    this.shadows = flight.options.createShadowRenderer(flight.host, {
      maxOpacity: flight.options.maxShadowOpacity,
    });
  }

  draw(): void {
    const { calc, direction, layout } = this.flight;
    if (!calc.ready) return;

    this.drawFlap();
    this.drawUnderneath();

    const progress = calc.getFlippingProgress();
    const width = ((layout.pageWidth * 0.75) * progress) / 100;

    this.shadows.draw(
      {
        start: calc.getShadowStartPoint(),
        angle: calc.getShadowAngle() + (3 * Math.PI) / 2,
        progress,
        width,
        opacity: ((100 - progress) * this.flight.options.maxShadowOpacity) / 100,
        direction,
        pageRect: calc.getRect(),
        z: this.flight.z,
      },
      layout
    );
  }

  /** The lifted part of the turning sheet, showing its far face. */
  private drawFlap(): void {
    const { calc, direction, layout, leadEl, z } = this.flight;
    const angle = calc.getAngle();
    const corner = calc.getActiveCorner();
    const origin = layout.toGlobal(corner, direction);

    const clip = toPolygon(
      mapPoints(calc.getFlippingClipArea(), (p) =>
        rotatePoint(relative(p, corner, direction), { x: 0, y: 0 }, angle)
      )
    );

    leadEl.style.cssText = pageCss({
      width: layout.pageWidth,
      height: layout.height,
      transform: `translate3d(${origin.x}px,${origin.y}px,0) rotate(${angle}rad)`,
      clip,
      z,
    });
  }

  /**
   * What shows in the area the fold has swept past.
   *
   * Normally that is the next sheet's face, drawn clipped to the vacated region.
   * At the first and last sheets there is nothing underneath, so instead the
   * near face gets clipped to the region NOT yet swept — otherwise it sits there
   * whole until the turn commits, looking like a stray page lying flat.
   */
  private drawUnderneath(): void {
    const { calc, direction, layout, bottomEl, restEl, z } = this.flight;

    if (bottomEl) {
      const base = calc.getBottomPagePosition();
      const origin = layout.toGlobal(base, direction);
      const clip = toPolygon(
        mapPoints(calc.getBottomClipArea(), (p) => relative(p, base, direction))
      );

      bottomEl.style.cssText = pageCss({
        width: layout.pageWidth,
        height: layout.height,
        transform: `translate3d(${origin.x}px,${origin.y}px,0)`,
        clip,
        z: z - 10,
      });
      return;
    }

    if (restEl && this.flight.restInSlot()) {
      const clip = vacateClip(calc, direction);
      if (clip) {
        // Only the clip: the static composite has already positioned this page
        // and given it its resting shadow, which now follows the clipped shape.
        restEl.style.clipPath = clip;
        restEl.style.setProperty("-webkit-clip-path", clip);
      }
    }
  }

  destroy(): void {
    this.shadows.destroy();
  }
}

/** Page-space point relative to an origin; BACK page space is mirrored. */
function relative(p: Point, origin: Point, direction: Direction): Point {
  return direction === Direction.Back
    ? { x: -p.x + origin.x, y: p.y - origin.y }
    : { x: p.x - origin.x, y: p.y - origin.y };
}

function pageCss(o: {
  width: number;
  height: number;
  transform: string;
  clip: string;
  z: number;
}): string {
  return [
    "display:block",
    "position:absolute",
    "left:0",
    "top:0",
    `width:${o.width}px`,
    `height:${o.height}px`,
    "transform-origin:0 0",
    `transform:${o.transform}`,
    `clip-path:${o.clip}`,
    `-webkit-clip-path:${o.clip}`,
    `z-index:${o.z}`,
  ].join(";");
}

export const createSoftSheetRenderer = (flight: FlightView): SheetRenderer =>
  new SoftSheetRenderer(flight);
