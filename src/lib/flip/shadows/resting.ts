/**
 * The shadow a page casts while lying still in its slot.
 *
 * IMPORTANT: this is a `filter` on the PAGE, not a separate element behind the
 * book, and that is load-bearing rather than incidental.
 *
 * `drop-shadow` traces an element's real alpha, so when a page is clipped —
 * peeling to a diagonal sliver as the book opens or closes — its shadow peels
 * with it. A standalone shadow element can only ever outline a rectangle, so it
 * stayed a full page-sized slab under a half that had already emptied, reading
 * as a ghost page lying on the background. Fading it did not help: a fading
 * rectangle is still a rectangle.
 *
 * Applied ONLY to pages resting in a slot:
 *  - not to flight clones, which carry the gradient curl shadows instead;
 *  - not to a revealed bottom page, whose clipped edge sits at the fold where a
 *    second shadow would double up on those gradients.
 */
export const DEFAULT_RESTING_SHADOW =
  "drop-shadow(0 16px 17px rgba(36, 28, 20, 0.26))";
