// Deterministic pagination for the book's transaction ledger. Pure and
// testable — chunks rows into fixed-size pages so each physical leaf of the
// book holds exactly one chunk. No DOM measurement: rows-per-page is a fixed
// constant chosen to fit a page height.

export type LedgerRow = {
  id: string;
  date: string; // booking_date, "YYYY-MM-DD"
  label: string; // merchant / description / counterparty
  category: string | null;
  amount: number; // signed; negative = money out
  currency: string;
};

// Tuned to fit one book leaf. Kept modest so pages read like a register.
export const ROWS_PER_LEDGER_PAGE = 14;

// The flip engine renders every page up front (no virtualization), so we bound
// how many transactions the book paginates. Older history lives in the classic
// /transactions view. ~14 rows/page → ~14 leaves at the cap.
export const LEDGER_TXN_CAP = 200;

export function buildLedgerPages(
  rows: LedgerRow[],
  rowsPerPage: number = ROWS_PER_LEDGER_PAGE
): LedgerRow[][] {
  if (rows.length === 0) return [];
  const pages: LedgerRow[][] = [];
  for (let i = 0; i < rows.length; i += rowsPerPage) {
    pages.push(rows.slice(i, i + rowsPerPage));
  }
  return pages;
}
