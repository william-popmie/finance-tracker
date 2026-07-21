import { createGradientShadowRenderer } from "./shadows/gradient";
import { DEFAULT_RESTING_SHADOW } from "./shadows/resting";
import type { ShadowRendererFactory } from "./shadows/types";

export type Easing = (t: number) => number;

/** Ease-in-out quad — the curve the approved prototype used. */
export const easeInOutQuad: Easing = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export interface FlipOptions {
  /** Duration of one turn, ms. */
  flipMs: number;
  /**
   * Delay between successive turns in a riffle, ms.
   *
   * Pages in the air at once is roughly `flipMs / riffleStagger`, so this is
   * the knob for how much overlap a rapid burst shows. Note it INVERTS the old
   * StPageFlip constraint, where the gap had to EXCEED the flip duration or the
   * library silently dropped the flip.
   */
  riffleStagger: number;
  /** Most turns animated for one navigation; the rest are absorbed. */
  riffleCap: number;
  easing: Easing;

  /** Release animation length, as a fraction of `flipMs`. */
  dragReleaseScale: number;
  /** Progress (0-100) past which releasing a drag completes the turn. */
  dragCompleteThreshold: number;

  /** Page aspect, width / height. */
  pageRatio: number;
  maxPageWidth: number;

  maxShadowOpacity: number;
  /** CSS `filter` value for a page at rest. See `shadows/resting.ts`. */
  restingShadow: string;
  createShadowRenderer: ShadowRendererFactory;
}

/**
 * Tuning approved in the prototype. `flipMs 420` with `riffleStagger 30` puts
 * ~14 turns' worth of overlap available, which reads as a real riffle.
 */
export const DEFAULT_OPTIONS: FlipOptions = {
  flipMs: 420,
  riffleStagger: 30,
  riffleCap: 6,
  easing: easeInOutQuad,

  dragReleaseScale: 0.7,
  dragCompleteThreshold: 50,

  pageRatio: 440 / 600,
  maxPageWidth: 480,

  maxShadowOpacity: 0.5,
  restingShadow: DEFAULT_RESTING_SHADOW,
  createShadowRenderer: createGradientShadowRenderer,
};

export function resolveOptions(
  overrides?: Partial<FlipOptions>
): FlipOptions {
  return { ...DEFAULT_OPTIONS, ...overrides };
}
