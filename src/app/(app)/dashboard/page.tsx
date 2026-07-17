import Link from "next/link";
import { db } from "@/lib/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Category } from "@/lib/types";
import {
  CategoryBars,
  MonthlyTrendChart,
  type CategorySpend,
  type MonthlyPoint,
} from "./charts";
import {
  InsightsPanel,
  type InsightRow,
  type ProposedExpectation,
} from "./insights-panel";

export const dynamic = "force-dynamic";

function eur(n: number) {
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

export default async function DashboardPage() {
  const now = new Date();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const sixMonthsAgoIso = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    .toISOString()
    .slice(0, 10);

  const [windowTx, recent, countRow, categories, openInsights, proposedExpectations] =
    await Promise.all([
      db
        .selectFrom("transactions")
        .select(["booking_date", "amount", "category_id"])
        .where("booking_date", ">=", sixMonthsAgoIso)
        .execute(),
      db
        .selectFrom("transactions")
        .selectAll()
        .orderBy("booking_date", "desc")
        .limit(6)
        .execute(),
      db
        .selectFrom("transactions")
        .select(db.fn.countAll().as("count"))
        .executeTakeFirst(),
      db.selectFrom("categories").selectAll().execute() as Promise<Category[]>,
      db
        .selectFrom("insights")
        .select(["id", "type", "severity", "title", "body", "created_at"])
        .where("status", "=", "open")
        .orderBy("created_at", "desc")
        .limit(10)
        .execute(),
      db
        .selectFrom("expectations")
        .select(["id", "label", "expected_amount", "cadence"])
        .where("status", "=", "proposed")
        .orderBy("created_at", "desc")
        .limit(10)
        .execute(),
    ]);

  const totalCount = Number(countRow?.count ?? 0);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const topLevel = (id: string | null): Category | null => {
    if (!id) return null;
    const c = byId.get(id);
    if (!c) return null;
    return c.parent_id ? (byId.get(c.parent_id) ?? c) : c;
  };

  type WindowTx = { booking_date: string; amount: number; category_id: string | null };
  const txs: WindowTx[] = windowTx;

  // Monthly income vs spending, last 6 months.
  const monthly = new Map<string, MonthlyPoint>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    monthly.set(key, {
      month: d.toLocaleDateString("en", { month: "short" }),
      income: 0,
      spent: 0,
    });
  }
  for (const t of txs) {
    const point = monthly.get(t.booking_date.slice(0, 7));
    if (!point) continue;
    const amount = Number(t.amount);
    if (amount >= 0) point.income += amount;
    else point.spent += -amount;
  }

  // This month's spending by top-level category.
  const byCategory = new Map<string, CategorySpend>();
  let monthSpent = 0;
  let monthReceived = 0;
  for (const t of txs) {
    if (t.booking_date < monthStartIso) continue;
    const amount = Number(t.amount);
    if (amount >= 0) {
      monthReceived += amount;
      continue;
    }
    monthSpent += -amount;
    const cat = topLevel(t.category_id);
    const name = cat?.name ?? "Uncategorized";
    const entry = byCategory.get(name) ?? {
      name,
      value: 0,
      color: cat?.color ?? null,
    };
    entry.value += -amount;
    byCategory.set(name, entry);
  }
  const categorySpend = [...byCategory.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {totalCount === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No transactions yet.{" "}
            <Link href="/upload" className="font-medium text-foreground underline">
              Upload your first statement
            </Link>{" "}
            to get started.
          </CardContent>
        </Card>
      ) : (
        <>
          <InsightsPanel
            insights={openInsights as InsightRow[]}
            proposals={proposedExpectations as ProposedExpectation[]}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Spent this month
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-[#e11d48]">
                {eur(monthSpent)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Received this month
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold text-[#0d9488]">
                {eur(monthReceived)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total transactions
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{totalCount}</CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Last 6 months</CardTitle>
              </CardHeader>
              <CardContent>
                <MonthlyTrendChart data={[...monthly.values()]} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  This month&apos;s spending by category
                </CardTitle>
              </CardHeader>
              <CardContent>
                {categorySpend.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No spending recorded this month yet.
                  </p>
                ) : (
                  <CategoryBars data={categorySpend} />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent transactions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {recent.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {t.description || t.counterparty_name || t.raw_description}
                      </p>
                      <p className="text-xs text-muted-foreground">{t.booking_date}</p>
                    </div>
                    <span
                      className={t.amount < 0 ? "text-[#e11d48]" : "text-[#0d9488]"}
                    >
                      {eur(Number(t.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
