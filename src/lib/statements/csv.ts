import Papa from "papaparse";
import { parse as parseDate, isValid, format } from "date-fns";
import type { CsvMapping, ExtractedStatement, ExtractedTransaction } from "@/lib/ai/extract";

export function parseCsvText(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  // Belgian bank exports commonly use ';' — papaparse auto-detects delimiters.
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parse error: ${result.errors[0].message}`);
  }
  return {
    headers: result.meta.fields ?? [],
    rows: result.data,
  };
}

function parseAmount(raw: string | undefined, decimalSeparator: "," | "."): number | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d,.\-+]/g, "");
  if (decimalSeparator === ",") {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseIsoDate(raw: string | undefined, dateFormat: string): string | null {
  if (!raw) return null;
  const d = parseDate(raw.trim(), dateFormat, new Date());
  if (!isValid(d)) return null;
  return format(d, "yyyy-MM-dd");
}

/**
 * Apply an AI-produced column mapping to parsed CSV rows, yielding the same
 * shape the PDF extractor produces. Pure code — zero API cost per row.
 */
export function transformCsvRows(
  rows: Record<string, string>[],
  mapping: CsvMapping
): ExtractedStatement {
  const transactions: ExtractedTransaction[] = [];
  let accountIban: string | null = null;

  for (const row of rows) {
    const bookingDate = parseIsoDate(
      mapping.booking_date ? row[mapping.booking_date] : undefined,
      mapping.date_format
    );
    if (!bookingDate) continue; // skip non-transaction rows (footers, blanks)

    let amount: number | null = null;
    if (mapping.amount) {
      amount = parseAmount(row[mapping.amount], mapping.decimal_separator);
    } else {
      const debit = parseAmount(
        mapping.debit ? row[mapping.debit] : undefined,
        mapping.decimal_separator
      );
      const credit = parseAmount(
        mapping.credit ? row[mapping.credit] : undefined,
        mapping.decimal_separator
      );
      if (debit != null && debit !== 0) amount = -Math.abs(debit);
      else if (credit != null) amount = Math.abs(credit);
    }
    if (amount == null) continue;

    const rawDescription = mapping.description_columns
      .map((c) => row[c]?.trim())
      .filter(Boolean)
      .join(" | ");

    if (!accountIban && mapping.account_iban) {
      accountIban = row[mapping.account_iban]?.trim() || null;
    }

    transactions.push({
      booking_date: bookingDate,
      value_date: parseIsoDate(
        mapping.value_date ? row[mapping.value_date] : undefined,
        mapping.date_format
      ),
      amount,
      currency:
        (mapping.currency ? row[mapping.currency]?.trim() : null) ||
        mapping.default_currency,
      raw_description: rawDescription || "(no description)",
      counterparty_iban:
        (mapping.counterparty_iban ? row[mapping.counterparty_iban]?.trim() : null) ||
        null,
      counterparty_name:
        (mapping.counterparty_name ? row[mapping.counterparty_name]?.trim() : null) ||
        null,
    });
  }

  const dates = transactions.map((t) => t.booking_date).sort();

  return {
    account_iban: accountIban,
    bank_name: null,
    period_start: dates[0] ?? null,
    period_end: dates[dates.length - 1] ?? null,
    opening_balance: null,
    closing_balance: null,
    transactions,
  };
}
