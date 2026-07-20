import type { LedgerRow } from "@/lib/ledger";
import { categoryColor } from "@/lib/category-colors";

function money(n: number, currency: string) {
  const abs = new Intl.NumberFormat("nl-BE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  const sym = currency === "EUR" ? "€" : `${currency} `;
  return `${n >= 0 ? "+" : "−"}${sym}${abs}`;
}

function dayMonth(iso: string) {
  const [, m, d] = iso.slice(0, 10).split("-");
  const month = new Date(`${iso.slice(0, 7)}-01`).toLocaleString("en", {
    month: "short",
  });
  return { day: d, month, key: `${d} ${month}` };
}

// The chapter divider that opens the register.
export function LedgerChapter({
  entryCount,
  monthLabel,
}: {
  entryCount: number;
  monthLabel: string;
}) {
  return (
    <div className="book-page">
      <div className="book-page-inner book-ledger-chapter">
        <div className="np-kicker">Part Two</div>
        <h2 className="book-chapter-title">The Register</h2>
        <div className="book-chapter-rule" />
        <p className="book-chapter-sub">
          A full accounting of transactions, most recent first.
        </p>
        <div className="book-chapter-meta">
          <span>{entryCount} entries</span>
          <span>through {monthLabel}</span>
        </div>
      </div>
    </div>
  );
}

// One leaf of the register: a ruled ledger of entries.
export function LedgerPage({
  rows,
  pageNumber,
  totalPages,
  continues,
}: {
  rows: LedgerRow[];
  pageNumber: number;
  totalPages: number;
  continues: boolean;
}) {
  return (
    <div className="book-page">
      <div className="book-page-inner book-ledger">
        <div className="book-ledger-head">
          <span className="book-ledger-col-date">Date</span>
          <span className="book-ledger-col-entry">Entry</span>
          <span className="book-ledger-col-amt">Amount</span>
        </div>
        <div className="book-ledger-rows">
          {rows.map((r) => {
            const { key } = dayMonth(r.date);
            return (
              <div key={r.id} className="book-ledger-row">
                <span className="book-ledger-col-date figure">{key}</span>
                <span className="book-ledger-col-entry">
                  <span className="book-ledger-label">{r.label}</span>
                  {r.category && (
                    <span className="book-ledger-cat">
                      <span
                        className="book-ledger-dot"
                        style={{ backgroundColor: categoryColor(r.category) }}
                      />
                      {r.category}
                    </span>
                  )}
                </span>
                <span
                  className={`book-ledger-col-amt figure ${
                    r.amount >= 0 ? "text-pos" : "text-foreground"
                  }`}
                >
                  {money(r.amount, r.currency)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="book-ledger-foot np-mono">
          <span>Folio {pageNumber} of {totalPages}</span>
          <span className="text-muted-foreground">
            {continues ? "carried forward →" : "end of register"}
          </span>
        </div>
      </div>
    </div>
  );
}

// Shown when there are no transactions yet.
export function LedgerEmpty() {
  return (
    <div className="book-page">
      <div className="book-page-inner book-ledger">
        <div className="book-ledger-head">
          <span className="book-ledger-col-date">Date</span>
          <span className="book-ledger-col-entry">Entry</span>
          <span className="book-ledger-col-amt">Amount</span>
        </div>
        <div className="book-ledger-empty">
          <p>No entries have been recorded yet.</p>
          <p className="text-muted-foreground">
            Upload a statement and the register will begin to fill.
          </p>
        </div>
      </div>
    </div>
  );
}
