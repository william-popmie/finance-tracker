import { NextResponse, after } from "next/server";
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
import { parseBnpDescriptor } from "@/lib/statements/bnp";
import { startRun, executeRun } from "@/lib/ai/categorization-runs";
import { log, logError } from "@/lib/log";

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
    log("parse", `start: statement ${statement.id} (${statement.file_name}, ${statement.file_type})`);
    const buffer = await readUpload(statement.storage_path);

    const t0 = Date.now();
    const extracted =
      statement.file_type === "pdf"
        ? await extractFromPdf(buffer.toString("base64"))
        : await extractCsv(buffer.toString("utf-8"));
    log(
      "parse",
      `extraction finished in ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
        `${extracted.transactions.length} transactions, period ${extracted.period_start}..${extracted.period_end}, iban ${extracted.account_iban}`
    );

    if (extracted.transactions.length === 0) {
      throw new Error("No transactions found in this file.");
    }

    const account = await findOrCreateAccount(
      db,
      extracted.account_iban,
      extracted.bank_name
    );
    log("parse", `account: ${account.name} (${account.id})`);

    // BNP pre-pass: deterministic merchant candidate + bank reference per row,
    // so rows display something clean immediately (AI refines it later).
    let bnpMerchants = 0;
    let bnpRefs = 0;
    const allRows = withDedupeHashes(extracted.transactions).map(
      ({ tx, dedupe_hash }) => {
        const bnp = parseBnpDescriptor(tx.raw_description);
        if (bnp.merchantCandidate) bnpMerchants++;
        if (bnp.bankReference) bnpRefs++;
        return {
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
          bank_reference: bnp.bankReference,
          description: bnp.cleaned,
        };
      }
    );
    log(
      "parse",
      `BNP pre-pass: ${bnpMerchants}/${allRows.length} merchant candidates, ${bnpRefs} bank references`
    );

    // Secondary duplicate filter: skip rows whose bank reference already
    // exists for this account (stable even if descriptor formatting changes).
    const refs = allRows.map((r) => r.bank_reference).filter((r): r is string => r !== null);
    let refSkipped = 0;
    let rows = allRows;
    if (refs.length > 0) {
      const existing = await db
        .selectFrom("transactions")
        .select("bank_reference")
        .where("account_id", "=", account.id)
        .where("bank_reference", "in", refs)
        .execute();
      const known = new Set(existing.map((e) => e.bank_reference));
      if (known.size > 0) {
        rows = allRows.filter((r) => !r.bank_reference || !known.has(r.bank_reference));
        refSkipped = allRows.length - rows.length;
      }
    }

    // Insert with duplicate-skipping on (account_id, dedupe_hash).
    const inserted = rows.length
      ? await db
          .insertInto("transactions")
          .values(rows)
          .onConflict((oc) => oc.columns(["account_id", "dedupe_hash"]).doNothing())
          .returning("id")
          .execute()
      : [];
    const insertedCount = inserted.length;
    const hashSkipped = rows.length - insertedCount;
    log(
      "parse",
      `insert: ${insertedCount} new, ${hashSkipped} hash-duplicates skipped, ${refSkipped} bank-reference-duplicates skipped`
    );

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

    // Kick off categorization (+ insight pass) in the background so this
    // response returns in seconds; progress is persisted in
    // categorization_runs and polled by the transactions page.
    const run = await startRun(db, "import");
    if (run) {
      after(() => executeRun(db, run));
      log("parse", `background categorization run ${run.id} scheduled`);
    }

    return NextResponse.json({
      inserted: insertedCount,
      skipped: hashSkipped + refSkipped,
      account: account.name,
      categorizationStarted: Boolean(run),
    });
  } catch (err) {
    logError("parse", `statement ${statement.id} (${statement.file_name}) failed`, err);
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
    log("parse", "CSV column mapping: cache hit");
    mapping = CsvMappingSchema.parse(cached.mapping);
  } else {
    log("parse", "CSV column mapping: cache miss — asking Claude");
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
