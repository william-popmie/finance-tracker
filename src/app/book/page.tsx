import Link from "next/link";
import { db } from "@/lib/db";
import { loadEdition } from "@/lib/frontpage-data";
import {
  buildLedgerPages,
  LEDGER_TXN_CAP,
  type LedgerRow,
} from "@/lib/ledger";
import { BookShell, type Chapter } from "./book-shell";
import { Cover } from "./pages/cover";
import { NewspaperLeft, NewspaperRight } from "./pages/newspaper-spread";
import { LedgerChapter, LedgerPage, LedgerEmpty } from "./pages/ledger";

export const dynamic = "force-dynamic";

type LedgerQueryRow = {
  id: string;
  booking_date: string;
  amount: number;
  currency: string;
  description: string | null;
  counterparty_name: string | null;
  merchant_name: string | null;
  category_name: string | null;
};

export default async function BookPage() {
  const { edition, isFirstEdition } = await loadEdition();

  const rawRows = (await db
    .selectFrom("transactions")
    .leftJoin("merchants", "merchants.id", "transactions.merchant_id")
    .leftJoin("categories", "categories.id", "transactions.category_id")
    .select([
      "transactions.id as id",
      "transactions.booking_date as booking_date",
      "transactions.amount as amount",
      "transactions.currency as currency",
      "transactions.description as description",
      "transactions.counterparty_name as counterparty_name",
      "merchants.canonical_name as merchant_name",
      "categories.name as category_name",
    ])
    .orderBy("transactions.booking_date", "desc")
    .orderBy("transactions.created_at", "desc")
    .limit(LEDGER_TXN_CAP)
    .execute()) as LedgerQueryRow[];

  const rows: LedgerRow[] = rawRows.map((r) => ({
    id: r.id,
    date: r.booking_date,
    label: (
      r.merchant_name ||
      r.description ||
      r.counterparty_name ||
      "Unknown"
    ).replace(/\s+/g, " "),
    category: r.category_name,
    amount: Number(r.amount),
    currency: r.currency,
  }));

  const ledgerPages = buildLedgerPages(rows);
  const entryCount = rows.length;

  // Leaf order drives page indices. showCover renders leaf 0 alone, then
  // pairs (1,2), (3,4)… so the newspaper occupies the first opening.
  const pages: React.ReactNode[] = [
    <Cover key="cover" edition={edition} />,
    <NewspaperLeft key="np-left" edition={edition} />,
    <NewspaperRight key="np-right" edition={edition} />,
    <LedgerChapter
      key="ledger-chapter"
      entryCount={entryCount}
      monthLabel={edition.dateline.monthLabel}
    />,
  ];

  if (ledgerPages.length === 0) {
    pages.push(<LedgerEmpty key="ledger-empty" />);
  } else {
    ledgerPages.forEach((chunk, i) => {
      pages.push(
        <LedgerPage
          key={`ledger-${i}`}
          rows={chunk}
          pageNumber={i + 1}
          totalPages={ledgerPages.length}
          continues={i < ledgerPages.length - 1}
        />
      );
    });
  }

  const chapters: Chapter[] = [
    { label: "Cover", page: 0 },
    { label: "Front Page", page: 1 },
    { label: "The Register", page: 3 },
  ];

  return (
    <div className="book-root">
      {isFirstEdition && (
        <div className="book-banner">
          <span>No transactions yet — this is a template edition.</span>
          <Link href="/upload" className="font-medium text-brand-strong underline">
            Upload a statement
          </Link>
        </div>
      )}
      <BookShell chapters={chapters}>{pages}</BookShell>
    </div>
  );
}
