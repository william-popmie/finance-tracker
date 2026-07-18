import { z } from "zod";
import { generateJson, MODELS } from "./config";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const ExtractedTransactionSchema = z.object({
  booking_date: isoDate,
  value_date: isoDate.nullable(),
  amount: z
    .number()
    .describe("Signed amount: negative = money leaving the account"),
  currency: z.string().describe("ISO currency code, e.g. EUR"),
  raw_description: z
    .string()
    .describe("The full raw transaction text exactly as printed"),
  counterparty_iban: z.string().nullable(),
  counterparty_name: z.string().nullable(),
});

export const ExtractedStatementSchema = z.object({
  account_iban: z.string().nullable().describe("IBAN of the statement's own account"),
  bank_name: z.string().nullable(),
  period_start: isoDate.nullable(),
  period_end: isoDate.nullable(),
  opening_balance: z.number().nullable(),
  closing_balance: z.number().nullable(),
  transactions: z.array(ExtractedTransactionSchema),
});

export type ExtractedStatement = z.infer<typeof ExtractedStatementSchema>;
export type ExtractedTransaction = z.infer<typeof ExtractedTransactionSchema>;

const EXTRACT_SYSTEM = `You extract transactions from bank statements (often BNP Paribas Fortis / Hello Bank, Belgium — but handle any bank).

Rules:
- Extract EVERY transaction row. Do not skip, merge, or summarize rows.
- amount is signed: money leaving the account is negative, money arriving is positive.
- Dates in the statement may be DD/MM/YYYY or DD-MM — always output ISO YYYY-MM-DD, inferring the year from the statement period.
- raw_description must be the complete raw text of the transaction line(s), untouched (including card numbers, reference codes).
- For wire transfers, extract the structured counterparty IBAN and name when printed.
- opening_balance / closing_balance: the statement-level balances if printed (per-row running balances usually don't exist).
- If a value is not present, use null. Never invent data.`;

/**
 * Extract a statement from a PDF (text-based or scanned — Claude's document
 * input handles OCR natively).
 */
export async function extractFromPdf(
  pdfBase64: string
): Promise<ExtractedStatement> {
  return generateJson({
    model: MODELS.extract,
    schema: ExtractedStatementSchema,
    system: EXTRACT_SYSTEM,
    parts: [
      { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
      {
        text: "Extract all transactions and statement metadata from this bank statement.",
      },
    ],
    maxOutputTokens: 65536, // long statements, many rows
  });
}

// ---------------------------------------------------------------------------
// CSV column mapping — one small Claude call per unseen header signature.
// ---------------------------------------------------------------------------

export const CsvMappingSchema = z.object({
  booking_date: z.string().nullable().describe("Column name holding the booking date"),
  value_date: z.string().nullable(),
  amount: z
    .string()
    .nullable()
    .describe("Column with a single signed amount, if the bank uses one"),
  debit: z.string().nullable().describe("Column with money-out amounts, if split"),
  credit: z.string().nullable().describe("Column with money-in amounts, if split"),
  currency: z.string().nullable(),
  description_columns: z
    .array(z.string())
    .describe("Columns to join (in order) into the raw description"),
  counterparty_iban: z.string().nullable(),
  counterparty_name: z.string().nullable(),
  account_iban: z
    .string()
    .nullable()
    .describe("Column holding the statement's own account IBAN, if present"),
  date_format: z
    .string()
    .describe("date-fns format of the date columns, e.g. dd/MM/yyyy or yyyy-MM-dd"),
  decimal_separator: z.enum([",", "."]),
  default_currency: z.string().describe("ISO code to assume when no currency column"),
});

export type CsvMapping = z.infer<typeof CsvMappingSchema>;

export async function mapCsvColumns(
  headers: string[],
  sampleRows: Record<string, string>[]
): Promise<CsvMapping> {
  return generateJson({
    model: MODELS.extract,
    schema: CsvMappingSchema,
    system:
      "You map bank-CSV export columns onto a normalized transaction schema. Column names may be in Dutch, French, or English (Belgian banks). Answer strictly from the provided headers and sample rows.",
    parts: [
      {
        text: `CSV headers:\n${JSON.stringify(headers)}\n\nSample rows:\n${JSON.stringify(sampleRows.slice(0, 5), null, 2)}\n\nProduce the column mapping. Use null for fields that have no matching column. Every column name you output must be copied exactly from the headers list.`,
      },
    ],
    maxOutputTokens: 2000,
    thinkingBudget: 0,
  });
}
