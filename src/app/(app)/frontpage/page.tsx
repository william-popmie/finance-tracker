import Link from "next/link";
import { db } from "@/lib/db";
import type { Category } from "@/lib/types";
import { buildEdition, type MonthTxn, type RecentTxn, type WindowTxn } from "@/lib/frontpage";
import { Newspaper } from "./newspaper";

export const dynamic = "force-dynamic";

export default async function FrontPage() {
  // A statement-driven tracker is retrospective: the edition is the most recent
  // month that actually has activity, not necessarily the current calendar
  // month. Anchor everything to the latest transaction date.
  const maxRow = await db
    .selectFrom("transactions")
    .select(db.fn.max("booking_date").as("max"))
    .executeTakeFirst();

  const anchor = maxRow?.max
    ? (() => {
        const [y, m, d] = String(maxRow.max).slice(0, 10).split("-").map(Number);
        return new Date(y, m - 1, d);
      })()
    : new Date();

  const monthStartIso = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const sixMonthsAgoIso = new Date(anchor.getFullYear(), anchor.getMonth() - 5, 1)
    .toISOString()
    .slice(0, 10);

  const [windowTx, monthTx, recentTx, categories, insights, balanceRow, countRow] =
    await Promise.all([
      db
        .selectFrom("transactions")
        .select(["booking_date", "amount", "category_id"])
        .where("booking_date", ">=", sixMonthsAgoIso)
        .execute() as Promise<WindowTxn[]>,
      db
        .selectFrom("transactions")
        .leftJoin("merchants", "merchants.id", "transactions.merchant_id")
        .select([
          "transactions.booking_date as booking_date",
          "transactions.amount as amount",
          "transactions.category_id as category_id",
          "transactions.description as description",
          "transactions.counterparty_name as counterparty_name",
          "transactions.currency as currency",
          "merchants.canonical_name as merchant_name",
        ])
        .where("transactions.booking_date", ">=", monthStartIso)
        .execute() as Promise<MonthTxn[]>,
      db
        .selectFrom("transactions")
        .leftJoin("merchants", "merchants.id", "transactions.merchant_id")
        .select([
          "transactions.booking_date as booking_date",
          "transactions.amount as amount",
          "transactions.description as description",
          "transactions.counterparty_name as counterparty_name",
          "transactions.currency as currency",
          "merchants.canonical_name as merchant_name",
        ])
        .orderBy("transactions.booking_date", "desc")
        .limit(8)
        .execute() as Promise<RecentTxn[]>,
      db.selectFrom("categories").selectAll().execute() as Promise<Category[]>,
      db
        .selectFrom("insights")
        .select(["title", "body"])
        .where("status", "=", "open")
        .orderBy("created_at", "desc")
        .limit(1)
        .execute(),
      db
        .selectFrom("transactions")
        .select(db.fn.sum("amount").as("balance"))
        .executeTakeFirst(),
      db
        .selectFrom("transactions")
        .select(db.fn.countAll().as("count"))
        .executeTakeFirst(),
    ]);

  const edition = buildEdition({
    now: anchor,
    windowTx,
    monthTx,
    recentTx,
    categories,
    insights,
    balanceToDate: Number(balanceRow?.balance ?? 0),
  });

  const isFirstEdition = Number(countRow?.count ?? 0) === 0;

  return (
    <div className="space-y-4">
      {isFirstEdition && (
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 rounded-lg border border-border bg-secondary px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            No transactions yet — your first edition is a template.
          </span>
          <Link
            href="/upload"
            className="font-medium text-brand-strong underline"
          >
            Upload a statement
          </Link>
        </div>
      )}
      <Newspaper edition={edition} />
    </div>
  );
}
