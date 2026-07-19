"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Account, Category } from "@/lib/types";
import { GENERAL_PREFIX } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";

export type TransactionSearchParams = {
  from?: string;
  to?: string;
  account?: string;
  q?: string;
  min?: string;
  max?: string;
  type?: string;
  categories?: string;
  tags?: string;
  uncat?: string;
  page?: string;
};

type DatePreset = "this-month" | "last-30" | "last-month" | "ytd";

const DATE_PRESETS: [DatePreset, string][] = [
  ["this-month", "This month"],
  ["last-30", "Last 30 days"],
  ["last-month", "Last month"],
  ["ytd", "Year to date"],
];

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: DatePreset, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case "this-month":
      return { from: isoDate(new Date(y, m, 1)), to: isoDate(today) };
    case "last-30": {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { from: isoDate(start), to: isoDate(today) };
    }
    case "last-month": {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      return { from: isoDate(start), to: isoDate(end) };
    }
    case "ytd":
      return { from: isoDate(new Date(y, 0, 1)), to: isoDate(today) };
  }
}

type FilterState = {
  q: string;
  from: string;
  to: string;
  account: string | null;
  type: string | null;
  // Ids chosen from the top-level-only category list. A parent with no
  // entry (or an empty entry) in childSelections matches broadly (itself +
  // all its children, expanded server-side). A non-empty entry narrows the
  // filter; each value is either a child (leaf) id or the "g:<parentId>"
  // General token, which matches rows categorized at the bare parent level.
  selectedParentIds: string[];
  childSelections: Record<string, string[]>;
  tagValues: string[];
  min: string;
  max: string;
  uncat: boolean;
};

// Flattens the parent/child selection into the token list the server expects.
// A parent with no narrowing emits its plain id (expanded server-side to
// itself + children = broad). A narrowed parent emits its selected values
// verbatim — each already a leaf id or a "g:<parentId>" General token.
function effectiveCategoryIds(state: FilterState): string[] {
  return state.selectedParentIds.flatMap((pid) => {
    const kids = state.childSelections[pid];
    return kids && kids.length > 0 ? kids : [pid];
  });
}

// Reconstructs the parent/child selection from the URL token list (a mix of
// plain top-level ids = broad, leaf ids, and "g:<parentId>" General tokens).
function parseInitialCategories(
  raw: string | undefined,
  categories: Category[]
): { selectedParentIds: string[]; childSelections: Record<string, string[]> } {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const selectedParentIds: string[] = [];
  const childSelections: Record<string, string[]> = {};

  const registerParent = (pid: string) => {
    if (!(pid in childSelections)) {
      childSelections[pid] = [];
      if (!selectedParentIds.includes(pid)) selectedParentIds.push(pid);
    }
  };

  for (const token of raw ? raw.split(",").filter(Boolean) : []) {
    if (token.startsWith(GENERAL_PREFIX)) {
      const pid = token.slice(GENERAL_PREFIX.length);
      if (!byId.has(pid)) continue;
      registerParent(pid);
      childSelections[pid].push(token);
      continue;
    }
    const cat = byId.get(token);
    if (!cat) continue;
    if (cat.parent_id) {
      registerParent(cat.parent_id);
      childSelections[cat.parent_id].push(token);
    } else if (!selectedParentIds.includes(token)) {
      selectedParentIds.push(token);
    }
  }
  return { selectedParentIds, childSelections };
}

// Mirrors the URLSearchParams-cloning shape of the pageLink helper in
// page.tsx — always omits `page`, so any filter change resets pagination.
function buildHref(state: FilterState): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.account) params.set("account", state.account);
  if (state.type) params.set("type", state.type);
  if (state.min) params.set("min", state.min);
  if (state.max) params.set("max", state.max);
  const categoryIds = effectiveCategoryIds(state);
  if (state.uncat) {
    params.set("uncat", "1");
  } else if (categoryIds.length > 0) {
    params.set("categories", categoryIds.join(","));
  }
  if (state.tagValues.length > 0) params.set("tags", state.tagValues.join(","));
  const qs = params.toString();
  return `/transactions${qs ? `?${qs}` : ""}`;
}

export function TransactionFilters({
  initial,
  accounts,
  categories,
  tags,
}: {
  initial: TransactionSearchParams;
  accounts: Pick<Account, "id" | "name">[];
  categories: Category[];
  tags: string[];
}) {
  const router = useRouter();
  const [state, setState] = useState<FilterState>(() => ({
    q: initial.q ?? "",
    from: initial.from ?? "",
    to: initial.to ?? "",
    account: initial.account ?? null,
    type: initial.type ?? null,
    ...parseInitialCategories(initial.categories, categories),
    tagValues: initial.tags ? initial.tags.split(",").filter(Boolean) : [],
    min: initial.min ?? "",
    max: initial.max ?? "",
    uncat: !!initial.uncat,
  }));

  // Only top-level categories are offered in the main picker — the full
  // parent+child list gets long fast, so subcategories are revealed one
  // parent at a time (see subcategoryPickers below) instead of flattened in.
  const topLevelOptions = categories
    .filter((c) => !c.parent_id)
    .map((c) => ({ value: c.id, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const childrenByParent = new Map<string, { value: string; label: string }[]>();
  for (const c of categories) {
    if (!c.parent_id) continue;
    const list = childrenByParent.get(c.parent_id) ?? [];
    list.push({ value: c.id, label: c.name });
    childrenByParent.set(c.parent_id, list);
  }
  const parentNames = new Map(categories.filter((c) => !c.parent_id).map((c) => [c.id, c.name]));

  const subcategoryPickers = state.selectedParentIds
    .filter((pid) => childrenByParent.has(pid))
    .map((pid) => ({
      parentId: pid,
      parentName: parentNames.get(pid) ?? "",
      // "General" (value = the g:<parentId> token) matches rows categorized at
      // the bare parent level — the ones no subcategory would otherwise catch.
      options: [
        { value: `${GENERAL_PREFIX}${pid}`, label: "General — no subcategory" },
        ...childrenByParent.get(pid)!,
      ],
    }));

  const tagOptions = tags.map((t) => ({ value: t, label: t }));

  function setUncat(checked: boolean) {
    setState((s) => ({
      ...s,
      uncat: checked,
      selectedParentIds: checked ? [] : s.selectedParentIds,
      childSelections: checked ? {} : s.childSelections,
    }));
  }

  function setParentIds(ids: string[]) {
    setState((s) => {
      const childSelections: Record<string, string[]> = {};
      for (const id of ids) if (s.childSelections[id]) childSelections[id] = s.childSelections[id];
      return { ...s, selectedParentIds: ids, childSelections, uncat: ids.length > 0 ? false : s.uncat };
    });
  }

  function setChildIds(parentId: string, ids: string[]) {
    setState((s) => ({ ...s, childSelections: { ...s.childSelections, [parentId]: ids } }));
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(buildHref(state));
          }}
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">Search</label>
              <Input
                type="text"
                placeholder="Description, merchant…"
                value={state.q}
                onChange={(e) => setState((s) => ({ ...s, q: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                value={state.from}
                onChange={(e) => setState((s) => ({ ...s, from: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                value={state.to}
                onChange={(e) => setState((s) => ({ ...s, to: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {DATE_PRESETS.map(([preset, label]) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setState((s) => ({ ...s, ...presetRange(preset) }))}
              >
                {label}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Account</label>
              <Select
                value={state.account}
                onValueChange={(v) => setState((s) => ({ ...s, account: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All accounts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All accounts</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Type</label>
              <Select value={state.type} onValueChange={(v) => setState((s) => ({ ...s, type: v }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All</SelectItem>
                  <SelectItem value="expense">Expenses</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Category</label>
              <MultiSelectFilter
                placeholder={state.uncat ? "Cleared — uncat. only" : "Any category"}
                options={topLevelOptions}
                value={state.selectedParentIds}
                onChange={setParentIds}
                disabled={state.uncat}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Tags</label>
              <MultiSelectFilter
                placeholder="Any tag"
                options={tagOptions}
                value={state.tagValues}
                onChange={(ids) => setState((s) => ({ ...s, tagValues: ids }))}
              />
            </div>
          </div>

          {subcategoryPickers.length > 0 && (
            <div className="flex flex-wrap gap-3 rounded-lg border border-dashed border-input p-3">
              {subcategoryPickers.map(({ parentId, parentName, options }) => (
                <div key={parentId} className="min-w-48 flex-1">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    {parentName} subcategory (optional — leave empty to match all)
                  </label>
                  <MultiSelectFilter
                    placeholder={`All ${parentName}`}
                    options={options}
                    value={state.childSelections[parentId] ?? []}
                    onChange={(ids) => setChildIds(parentId, ids)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Min € (amount, either direction)
              </label>
              <Input
                type="number"
                step="0.01"
                value={state.min}
                onChange={(e) => setState((s) => ({ ...s, min: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Max € (amount, either direction)
              </label>
              <Input
                type="number"
                step="0.01"
                value={state.max}
                onChange={(e) => setState((s) => ({ ...s, max: e.target.value }))}
              />
            </div>
            <div className="col-span-2 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={state.uncat} onChange={(e) => setUncat(e.target.checked)} />
                Uncategorized only
              </label>
              <div className="flex items-center gap-2">
                <Link
                  href="/transactions"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  Reset
                </Link>
                <Button type="submit" size="sm">
                  Filter
                </Button>
              </div>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
