import Link from "next/link";
import { db } from "@/lib/db";
import type { TransactionWithRelations } from "@/lib/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TransactionsTable } from "./transactions-table";
import { CategorizeButton } from "./categorize-button";
import { CategorizationStatus } from "./categorization-status";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = {
  from?: string;
  to?: string;
  account?: string;
  q?: string;
  min?: string;
  max?: string;
  uncat?: string;
  page?: string;
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Applies the shared filter set to either the row query or the count query.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (qb: any): any => {
    let q = qb;
    if (sp.from) q = q.where("transactions.booking_date", ">=", sp.from);
    if (sp.to) q = q.where("transactions.booking_date", "<=", sp.to);
    if (sp.account) q = q.where("transactions.account_id", "=", sp.account);
    if (sp.min) q = q.where("transactions.amount", ">=", Number(sp.min));
    if (sp.max) q = q.where("transactions.amount", "<=", Number(sp.max));
    if (sp.uncat) q = q.where("transactions.category_id", "is", null);
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

  const [rows, countRow, accounts, categories] = await Promise.all([
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
    db.selectFrom("categories").selectAll().orderBy("name").execute(),
  ]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <div className="flex items-center gap-3">
          <CategorizationStatus />
          <p className="text-sm text-muted-foreground">{total} results</p>
          <CategorizeButton />
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <form className="grid grid-cols-2 gap-3 md:grid-cols-6" method="get">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">From</label>
              <Input type="date" name="from" defaultValue={sp.from} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">To</label>
              <Input type="date" name="to" defaultValue={sp.to} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Account</label>
              <select
                name="account"
                defaultValue={sp.account ?? ""}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Min €</label>
              <Input type="number" step="0.01" name="min" defaultValue={sp.min} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Max €</label>
              <Input type="number" step="0.01" name="max" defaultValue={sp.max} />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="mb-1 block text-xs text-muted-foreground">Search</label>
              <Input type="text" name="q" placeholder="Description…" defaultValue={sp.q} />
            </div>
            <div className="col-span-2 flex items-center gap-3 md:col-span-6">
              <Button type="submit" size="sm">
                Filter
              </Button>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  name="uncat"
                  value="1"
                  defaultChecked={!!sp.uncat}
                  className="h-4 w-4"
                />
                Uncategorized only
              </label>
              <Link
                href="/transactions"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Reset
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

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
