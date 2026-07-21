import type { SheetKind } from "../types";
import { createSoftSheetRenderer } from "./soft";
import type { SheetRendererFactory } from "./types";

/**
 * Which renderer draws a given kind of sheet.
 *
 * Both kinds map to the soft curl today. Hardcovers were removed after a run of
 * bugs whose real cause was the old page model, not the cover code — the sheet
 * model fixed that, and a rigid renderer can now be reintroduced cleanly.
 *
 * To bring hardcovers back: add `hard.ts` implementing `SheetRenderer`, point
 * `"hard"` at it here, and restore `perspective` on `.book-stage`. Nothing else
 * in the engine needs to change — the Cover markup already carries
 * `data-density="hard"`, so this registry will start routing it immediately.
 */
const RENDERERS: Record<SheetKind, SheetRendererFactory> = {
  soft: createSoftSheetRenderer,
  hard: createSoftSheetRenderer,
};

export function rendererFor(kind: SheetKind): SheetRendererFactory {
  return RENDERERS[kind] ?? createSoftSheetRenderer;
}
