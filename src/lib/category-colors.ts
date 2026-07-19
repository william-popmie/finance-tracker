// The categories table stores arbitrary bright colors (purple, blue, etc.) that
// clash with the warm-paper palette. Instead of trusting those, we map every
// category name deterministically onto a curated earthy palette so the same
// category always gets the same tone across the dashboard and transaction views.

const WARM_PALETTE = [
  "#c9754a", // sienna (brand)
  "#6b8b6e", // sage green
  "#c7a15c", // ochre
  "#a5674a", // terracotta
  "#83794f", // olive
  "#b58a6a", // clay tan
  "#5f7d6f", // pine
  "#9a6b52", // chestnut
];

// Stable hash → palette index. Same name always yields the same color.
export function categoryColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return WARM_PALETTE[h % WARM_PALETTE.length];
}
