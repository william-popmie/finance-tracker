import type { Category } from "@/lib/types";

export type CategoryPath = { id: string; path: string };

export function categoryPaths(categories: Category[]): CategoryPath[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categories
    .map((c) => {
      const parent = c.parent_id ? byId.get(c.parent_id) : null;
      return { id: c.id, path: parent ? `${parent.name} > ${c.name}` : c.name };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Prefix marking a "general" token: match the bare parent id exactly. */
export const GENERAL_PREFIX = "g:";

/**
 * Resolves category filter tokens to the exact set of `category_id`s for an
 * `in (...)` match. Token shapes (see transaction-filters.tsx):
 *   - plain top-level id → the parent itself + all its children (broad),
 *   - plain leaf id       → that leaf only,
 *   - "g:<parentId>"      → the bare parent id only ("general", no expansion,
 *                           i.e. rows categorized at the parent level whose
 *                           specific subcategory is "none of the above").
 * Two-level taxonomy, so a leaf never has children of its own.
 */
export function resolveCategoryFilterIds(
  tokens: string[],
  categories: Pick<Category, "id" | "parent_id">[]
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const c of categories) {
    if (!c.parent_id) continue;
    const list = childrenByParent.get(c.parent_id) ?? [];
    list.push(c.id);
    childrenByParent.set(c.parent_id, list);
  }
  const result = new Set<string>();
  for (const tok of tokens) {
    if (tok.startsWith(GENERAL_PREFIX)) {
      result.add(tok.slice(GENERAL_PREFIX.length));
    } else {
      result.add(tok);
      for (const childId of childrenByParent.get(tok) ?? []) result.add(childId);
    }
  }
  return [...result];
}
