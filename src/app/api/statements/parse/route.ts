import { NextResponse } from "next/server";
import { db, type Db } from "@/lib/db";
import { readUpload } from "@/lib/storage";
import {
  extractFromPdf,
  mapCsvColumns,
  CsvMappingSchema,
  type ExtractedStatement,
} from "@/lib/ai/extract";
import { parseCsvText, transformCsvRows } from "@/lib/statements/csv";
import { withDedupeHashes, sha256 } from "@/lib/statements/dedupe";
import { runCategorization } from "@/lib/ai/categorize";
import { runInsightPass } from "@/lib/insights/engine";

export const maxDuration = 300; // statement extraction can take a while

export async function POST(req: Request) {
  const { statementId } = (await req.json()) as { statementId?: string };
  if (!statementId) {
    return NextResponse.json({ error: "statementId required" }, { status: 400 });
  }

  const statement = await db
    .selectFrom("statements")
    .selectAll()
    .where("id", "=", statementId)
    .executeTakeFirst();
  if (!statement) {
    return NextResponse.json({ error: "Statement not found" }, { status: 404 });
  }

  await db
    .updateTable("statements")
    .set({ status: "parsing", error_msg: null })
    .where("id", "=", statement.id)
    .execute();

  try {
    const buffer = await readUpload(statement.storage_path);

    const extracted =
      statement.file_type === "pdf"
        ? await extractFromPdf(buffer.toString("base64"))
        : await extractCsv(buffer.toString("utf-8"));

    if (extracted.transactions.length === 0) {
      throw new Error("No transactions found in this file.");
    }

    const account = await findOrCreateAccount(
      db,
      extracted.account_iban,
      extracted.bank_name
    );

    // Insert with duplicate-skipping on (account_id, dedupe_hash).
    const rows = withDedupeHashes(extracted.transactions).map(
      ({ tx, dedupe_hash }) => ({
        account_id: account.id,
        statement_id: statement.id,
        booking_date: tx.booking_date,
        value_date: tx.value_date,
        amount: tx.amount,
        currency: tx.currency || "EUR",
        raw_description: tx.raw_description,
        counterparty_iban: tx.counterparty_iban,
        counterparty_name: tx.counterparty_name,
        dedupe_hash,
      })
    );

    const inserted = await db
      .insertInto("transactions")
      .values(rows)
      .onConflict((oc) => oc.columns(["account_id", "dedupe_hash"]).doNothing())
      .returning("id")
      .execute();
    const insertedCount = inserted.length;

    await db
      .updateTable("statements")
      .set({
        status: "parsed",
        account_id: account.id,
        period_start: extracted.period_start,
        period_end: extracted.period_end,
        opening_balance: extracted.opening_balance,
        closing_balance: extracted.closing_balance,
        transaction_count: insertedCount,
      })
      .where("id", "=", statement.id)
      .execute();

    // Categorize the new transactions (non-fatal if it fails — there's a
    // manual "Categorize" button as fallback).
    let categorized: { patternMatched: number; aiResolved: number } | null = null;
    try {
      categorized = await runCategorization(db);
    } catch (err) {
      console.error("Categorization after import failed:", err);
    }

    // Insight pass: recurring detection, missed/doubled payments,
    // reimbursements, unusual amounts. Also non-fatal.
    try {
      await runInsightPass(db);
    } catch (err) {
      console.error("Insight pass after import failed:", err);
    }

    return NextResponse.json({
      inserted: insertedCount,
      skipped: rows.length - insertedCount,
      account: account.name,
      categorized,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .updateTable("statements")
      .set({ status: "error", error_msg: message })
      .where("id", "=", statement.id)
      .execute();
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function extractCsv(text: string): Promise<ExtractedStatement> {
  const { headers, rows } = parseCsvText(text);
  if (headers.length === 0 || rows.length === 0) {
    throw new Error("CSV appears to be empty.");
  }

  // Column mapping is cached per header signature — one AI call per bank format, ever.
  const headerHash = sha256(headers.map((h) => h.trim().toLowerCase()).join("|"));
  const cached = await db
    .selectFrom("csv_mappings")
    .select("mapping")
    .where("header_hash", "=", headerHash)
    .executeTakeFirst();

  let mapping;
  if (cached) {
    mapping = CsvMappingSchema.parse(cached.mapping);
  } else {
    mapping = await mapCsvColumns(headers, rows);
    await db
      .insertInto("csv_mappings")
      .values({ header_hash: headerHash, mapping: JSON.stringify(mapping) })
      .onConflict((oc) => oc.column("header_hash").doNothing())
      .execute();
  }

  return transformCsvRows(rows, mapping);
}

async function findOrCreateAccount(
  database: Db,
  iban: string | null,
  bank: string | null
) {
  const normalizedIban = iban?.replace(/\s+/g, "").toUpperCase() || null;

  if (normalizedIban) {
    const existing = await database
      .selectFrom("accounts")
      .selectAll()
      .where("iban", "=", normalizedIban)
      .executeTakeFirst();
    if (existing) return existing;

    return database
      .insertInto("accounts")
      .values({ iban: normalizedIban, name: normalizedIban, bank })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // No IBAN in the file — fall back to a single "Unknown account".
  const existing = await database
    .selectFrom("accounts")
    .selectAll()
    .where("iban", "is", null)
    .executeTakeFirst();
  if (existing) return existing;

  return database
    .insertInto("accounts")
    .values({ name: "Unknown account", bank })
    .returningAll()
    .executeTakeFirstOrThrow();
}
