import Link from "next/link";
import { sql } from "kysely";
import { db } from "@/lib/db";
import type { TransactionWithRelations } from "@/lib/types";
import {
  categoryPaths,
  resolveCategoryFilterIds,
  GENERAL_PREFIX,
  type CategoryPath,
} from "@/lib/categories";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TransactionsTable } from "./transactions-table";
import { TransactionFilters, type TransactionSearchParams } from "./transaction-filters";
import { CategorizeButton } from "./categorize-button";
import { CategorizationStatus } from "./categorization-status";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = TransactionSearchParams;

const CHIP_LABELS: Record<string, string> = {
  q: "Search",
  from: "From",
  to: "To",
  account: "Account",
  type: "Type",
  min: "Min €",
  max: "Max €",
  uncat: "Uncategorized only",
};

const TYPE_LABELS: Record<string, string> = { expense: "Expenses", income: "Income" };

// Builds the removable-chip summary for the active filters. Multi-value
// params (categories, tags) get one chip per selected value; everything
// else gets a single chip. Each chip's href reconstructs the query string
// with just that one value/param removed.
function activeFilterChips(
  sp: SearchParams,
  paths: CategoryPath[],
  accountNames: Map<string, string>
): { key: string; label: string; href: string }[] {
  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "page") base.set(k, v);

  const withoutKey = (key: string) => {
    const params = new URLSearchParams(base);
    params.delete(key);
    const qs = params.toString();
    return `/transactions${qs ? `?${qs}` : ""}`;
  };

  const withoutListValue = (key: "categories" | "tags", value: string) => {
    const params = new URLSearchParams(base);
    const remaining = (sp[key] ?? "")
      .split(",")
      .filter((v) => v && v !== value);
    if (remaining.length > 0) params.set(key, remaining.join(","));
    else params.delete(key);
    const qs = params.toString();
    return `/transactions${qs ? `?${qs}` : ""}`;
  };

  const chips: { key: string; label: string; href: string }[] = [];

  for (const key of ["q", "from", "to", "account", "type", "min", "max", "uncat"] as const) {
    const value = sp[key];
    if (!value) continue;
    let label = `${CHIP_LABELS[key]}: ${value}`;
    if (key === "account") label = `Account: ${accountNames.get(value) ?? value}`;
    if (key === "type") label = `Type: ${TYPE_LABELS[value] ?? value}`;
    if (key === "uncat") label = CHIP_LABELS.uncat;
    chips.push({ key, label, href: withoutKey(key) });
  }

  if (sp.categories) {
    const byId = new Map(paths.map((p) => [p.id, p.path]));
    for (const token of sp.categories.split(",").filter(Boolean)) {
      // A "g:<parentId>" token is the bare-parent ("general") selection; a
      // plain id is either a broad top-level or a specific leaf.
      const isGeneral = token.startsWith(GENERAL_PREFIX);
      const id = isGeneral ? token.slice(GENERAL_PREFIX.length) : token;
      const label = isGeneral
        ? `Category: ${byId.get(id) ?? id} (general)`
        : `Category: ${byId.get(id) ?? id}`;
      chips.push({
        key: `category:${token}`,
        label,
        href: withoutListValue("categories", token),
      });
    }
  }

  if (sp.tags) {
    for (const tag of sp.tags.split(",").filter(Boolean)) {
      chips.push({ key: `tag:${tag}`, label: `Tag: ${tag}`, href: withoutListValue("tags", tag) });
    }
  }

  return chips;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Categories are fetched first (not in the Promise.all below) since
  // resolveCategoryFilterIds needs them before the row/count queries can be built.
  const categories = await db.selectFrom("categories").selectAll().orderBy("name").execute();

  const categoryIds =
    !sp.uncat && sp.categories
      ? resolveCategoryFilterIds(sp.categories.split(",").filter(Boolean), categories)
      : null;

  // Applies the shared filter set to either the row query or the count query.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (qb: any): any => {
    let q = qb;
    if (sp.from) q = q.where("transactions.booking_date", ">=", sp.from);
    if (sp.to) q = q.where("transactions.booking_date", "<=", sp.to);
    if (sp.account) q = q.where("transactions.account_id", "=", sp.account);

    // Uncategorized-only and category filtering are mutually exclusive;
    // `uncat` wins if both are somehow present (e.g. a hand-edited URL).
    if (sp.uncat) {
      q = q.where("transactions.category_id", "is", null);
    } else if (categoryIds && categoryIds.length > 0) {
      q = q.where("transactions.category_id", "in", categoryIds);
    }

    if (sp.type === "expense") q = q.where("transactions.amount", "<", 0);
    if (sp.type === "income") q = q.where("transactions.amount", ">", 0);

    // Magnitude filtering in SQL (not JS-after-limit) so pagination/count
    // stay correct. This also fixes the old bug where min/max compared
    // against the signed amount, silently excluding all expenses.
    if (sp.min) q = q.where(sql<number>`abs(transactions.amount)`, ">=", Number(sp.min));
    if (sp.max) q = q.where(sql<number>`abs(transactions.amount)`, "<=", Number(sp.max));

    if (sp.tags) {
      const tags = sp.tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) {
        // Postgres array overlap: matches ANY selected tag.
        q = q.where(sql<boolean>`${sql.ref("transactions.tags")} && ${sql.val(tags)}::text[]`);
      }
    }

    if (sp.q) {
      const pattern = `%${sp.q}%`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      q = q.where((eb: any) =>
        eb.or([
          eb("transactions.raw_description", "ilike", pattern),
          eb("transactions.description", "ilike", pattern),
          eb("transactions.counterparty_name", "ilike", pattern),
        ])
      );
    }
    return q;
  };

  const [rows, countRow, accounts, distinctTagRows] = await Promise.all([
    applyFilters(
      db
        .selectFrom("transactions")
        .leftJoin("accounts", "accounts.id", "transactions.account_id")
        .leftJoin("categories", "categories.id", "transactions.category_id")
        .leftJoin("merchants", "merchants.id", "transactions.merchant_id")
        .selectAll("transactions")
        .select([
          "accounts.name as account_name",
          "accounts.iban as account_iban",
          "categories.name as category_name",
          "categories.color as category_color",
          "categories.parent_id as category_parent_id",
          "merchants.canonical_name as merchant_name",
        ])
        .orderBy("transactions.booking_date", "desc")
        .orderBy("transactions.created_at", "desc")
        .limit(PAGE_SIZE)
        .offset(offset)
    ).execute(),
    applyFilters(
      db.selectFrom("transactions").select(db.fn.countAll().as("count"))
    ).executeTakeFirst(),
    db.selectFrom("accounts").selectAll().orderBy("name").execute(),
    db
      .selectFrom("transactions")
      .select(sql<string>`unnest(transactions.tags)`.as("tag"))
      .distinct()
      .orderBy("tag")
      .execute(),
  ]);

  const tags = distinctTagRows.map((r) => r.tag);

  const transactions: TransactionWithRelations[] = (
    rows as (TransactionWithRelations & {
      account_name: string | null;
      account_iban: string | null;
      category_name: string | null;
      category_color: string | null;
      category_parent_id: string | null;
      merchant_name: string | null;
    })[]
  ).map((r) => ({
    ...r,
    accounts: r.account_name ? { name: r.account_name, iban: r.account_iban } : null,
    categories: r.category_name
      ? {
          name: r.category_name,
          color: r.category_color,
          parent_id: r.category_parent_id,
        }
      : null,
    merchants: r.merchant_name ? { canonical_name: r.merchant_name } : null,
  }));

  const total = Number(countRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageLink = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/transactions${qs ? `?${qs}` : ""}`;
  };

  const paths = categoryPaths(categories);
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const chips = activeFilterChips(sp, paths, accountNames);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">{total} results</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Transactions</h1>
        </div>
        <div className="flex items-center gap-3">
          <CategorizationStatus />
          <CategorizeButton />
        </div>
      </div>

      <TransactionFilters initial={sp} accounts={accounts} categories={categories} tags={tags} />

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <Link key={chip.key} href={chip.href}>
              <Badge variant="outline" className="gap-1 hover:bg-muted">
                {chip.label}
                <span className="text-muted-foreground">✕</span>
              </Badge>
            </Link>
          ))}
          <Link
            href="/transactions"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear all
          </Link>
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          {transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No transactions match.{" "}
              <Link href="/upload" className="underline">
                Upload a statement
              </Link>{" "}
              if you haven&apos;t yet.
            </p>
          ) : (
            <TransactionsTable transactions={transactions} categories={categories} />
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              {page <= 1 ? (
                <Button variant="outline" size="sm" disabled>
                  Previous
                </Button>
              ) : (
                <Link
                  href={pageLink(page - 1)}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  Previous
                </Link>
              )}
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              {page >= totalPages ? (
                <Button variant="outline" size="sm" disabled>
                  Next
                </Button>
              ) : (
                <Link
                  href={pageLink(page + 1)}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  Next
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
