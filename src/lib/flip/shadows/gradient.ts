import { rotatePoint } from "../geometry/helper";
import { toPolygon } from "../geometry/polygon";
import type { BookLayout } from "../layout";
import { Direction } from "../types";
import type { Point } from "../types";
import type { ShadowRenderer, ShadowState } from "./types";

/**
 * The default shadow look: two clipped gradient divs per turn — one cast
 * outward from the fold, one running along the inside of the curl.
 *
 * Ported from StPageFlip's `HTMLRender.drawOuterShadow`/`drawInnerShadow` (MIT).
 * This pair is what actually sells the "soft page curl"; the page element itself
 * is only a flat clipped polygon. Kept faithful because the look is signed off.
 */
export class GradientShadowRenderer implements ShadowRenderer {
  private readonly outer: HTMLElement;
  private readonly inner: HTMLElement;

  constructor(private readonly host: HTMLElement) {
    this.outer = this.createLayer();
    this.inner = this.createLayer();
  }

  private createLayer(): HTMLElement {
    const el = document.createElement("div");
    el.className = "book-shadow";
    this.host.appendChild(el);
    return el;
  }

  draw(state: ShadowState, layout: BookLayout): void {
    if (!state.start) {
      this.outer.style.display = "none";
      this.inner.style.display = "none";
      return;
    }

    const origin = layout.toGlobal(state.start, state.direction);
    this.drawOuter(state, layout, origin);
    this.drawInner(state, layout, origin);
  }

  private drawOuter(
    state: ShadowState,
    layout: BookLayout,
    origin: Point
  ): void {
    const start = state.start as Point;
    const translate = state.direction === Direction.Back ? state.width : 0;
    const gradientDir =
      state.direction === Direction.Forward ? "to right" : "to left";

    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: layout.pageWidth, y: 0 },
      { x: layout.pageWidth, y: layout.height },
      { x: 0, y: layout.height },
    ];

    const clip = toPolygon(
      corners.map((p) =>
        rotatePoint(
          this.relative(p, start, state.direction),
          { x: translate, y: 100 },
          state.angle
        )
      )
    );

    this.outer.style.cssText = layer({
      z: state.z + 10,
      width: state.width,
      height: layout.height * 2,
      background: `linear-gradient(${gradientDir}, rgba(0,0,0,${state.opacity}), rgba(0,0,0,0))`,
      translate,
      origin,
      angle: state.angle,
      clip,
    });
  }

  private drawInner(
    state: ShadowState,
    layout: BookLayout,
    origin: Point
  ): void {
    const start = state.start as Point;
    const size = (state.width * 3) / 4;
    const translate = state.direction === Direction.Forward ? size : 0;
    const gradientDir =
      state.direction === Direction.Forward ? "to left" : "to right";

    const r = state.pageRect;
    const clip = toPolygon(
      [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map((p) =>
        rotatePoint(
          this.relative(p, start, state.direction),
          { x: translate, y: 100 },
          state.angle
        )
      )
    );

    this.inner.style.cssText = layer({
      z: state.z + 20,
      width: size,
      // Twice the page height: the band is rotated, so it has to stay long
      // enough to span the page at any fold angle.
      height: layout.height * 2,
      background:
        `linear-gradient(${gradientDir}, rgba(0,0,0,${state.opacity}) 5%,` +
        ` rgba(0,0,0,0.05) 15%, rgba(0,0,0,${state.opacity}) 35%, rgba(0,0,0,0) 100%)`,
      translate,
      origin,
      angle: state.angle,
      clip,
    });
  }

  /** Page-space point relative to the fold origin; BACK space is mirrored. */
  private relative(p: Point, start: Point, direction: Direction): Point {
    return direction === Direction.Back
      ? { x: -p.x + start.x, y: p.y - start.y }
      : { x: p.x - start.x, y: p.y - start.y };
  }

  destroy(): void {
    this.outer.remove();
    this.inner.remove();
  }
}

function layer(o: {
  z: number;
  width: number;
  height: number;
  background: string;
  translate: number;
  origin: Point;
  angle: number;
  clip: string;
}): string {
  return [
    "display:block",
    "position:absolute",
    `z-index:${o.z}`,
    `width:${o.width}px`,
    `height:${o.height}px`,
    `background:${o.background}`,
    `transform-origin:${o.translate}px 100px`,
    `transform:translate3d(${o.origin.x - o.translate}px,${o.origin.y - 100}px,0) rotate(${o.angle}rad)`,
    `clip-path:${o.clip}`,
    `-webkit-clip-path:${o.clip}`,
    "pointer-events:none",
  ].join(";");
}

export const createGradientShadowRenderer = (
  host: HTMLElement
): ShadowRenderer => new GradientShadowRenderer(host);
