import { Kysely, PostgresDialect, type ColumnType, type Generated } from "kysely";
import { Pool, types } from "pg";

// pg returns NUMERIC and DATE as strings/Date objects by default; the app
// works with plain numbers and "YYYY-MM-DD" strings everywhere.
types.setTypeParser(types.builtins.NUMERIC, (v) => Number.parseFloat(v));
types.setTypeParser(types.builtins.INT8, (v) => Number.parseInt(v, 10));
types.setTypeParser(types.builtins.DATE, (v) => v); // keep as YYYY-MM-DD string

type Timestamp = ColumnType<string, string | undefined, string>;

export interface Database {
  accounts: {
    id: Generated<string>;
    iban: string | null;
    name: string;
    bank: string | null;
    created_at: Timestamp;
  };
  statements: {
    id: Generated<string>;
    account_id: string | null;
    storage_path: string;
    file_name: string;
    file_type: "pdf" | "csv";
    period_start: string | null;
    period_end: string | null;
    opening_balance: number | null;
    closing_balance: number | null;
    status: ColumnType<
      "uploaded" | "parsing" | "parsed" | "error",
      "uploaded" | "parsing" | "parsed" | "error" | undefined,
      "uploaded" | "parsing" | "parsed" | "error"
    >;
    error_msg: string | null;
    transaction_count: number | null;
    created_at: Timestamp;
  };
  categories: {
    id: Generated<string>;
    name: string;
    parent_id: string | null;
    icon: string | null;
    color: string | null;
  };
  merchants: {
    id: Generated<string>;
    canonical_name: string;
    parent_brand: string | null;
    website: string | null;
    default_category_id: string | null;
    match_patterns: ColumnType<string[], string[] | undefined, string[]>;
    created_at: Timestamp;
  };
  transactions: {
    id: Generated<string>;
    account_id: string;
    statement_id: string | null;
    booking_date: string;
    value_date: string | null;
    amount: number;
    currency: ColumnType<string, string | undefined, string>;
    raw_description: string;
    counterparty_iban: string | null;
    counterparty_name: string | null;
    merchant_id: string | null;
    category_id: string | null;
    description: string | null;
    tags: ColumnType<string[], string[] | undefined, string[]>;
    notes: string | null;
    dedupe_hash: string;
    created_at: Timestamp;
  };
  csv_mappings: {
    id: Generated<string>;
    header_hash: string;
    mapping: unknown;
    created_at: Timestamp;
  };
  expectations: {
    id: Generated<string>;
    kind: "recurring" | "reimbursement";
    label: string;
    merchant_id: string | null;
    expected_amount: number | null;
    cadence: "weekly" | "monthly" | "quarterly" | "yearly" | null;
    counterpart_count: number | null;
    anchor_transaction_id: string | null;
    status: ColumnType<
      "proposed" | "active" | "paused" | "done",
      "proposed" | "active" | "paused" | "done" | undefined,
      "proposed" | "active" | "paused" | "done"
    >;
    notes: string | null;
    created_at: Timestamp;
  };
  insights: {
    id: Generated<string>;
    type: string;
    severity: ColumnType<
      "info" | "warning" | "alert",
      "info" | "warning" | "alert" | undefined,
      "info" | "warning" | "alert"
    >;
    title: string;
    body: string | null;
    related_transaction_ids: ColumnType<string[], string[] | undefined, string[]>;
    expectation_id: string | null;
    status: ColumnType<
      "open" | "dismissed" | "resolved",
      "open" | "dismissed" | "resolved" | undefined,
      "open" | "dismissed" | "resolved"
    >;
    created_at: Timestamp;
  };
  chat_conversations: {
    id: Generated<string>;
    title: string | null;
    created_at: Timestamp;
  };
  chat_messages: {
    id: Generated<string>;
    conversation_id: string;
    role: "user" | "assistant";
    content: unknown;
    created_at: Timestamp;
  };
}

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/finance_tracker";

// Singleton across Next.js hot reloads.
const globalForDb = globalThis as unknown as { __financeDb?: Kysely<Database> };

export const db: Kysely<Database> =
  globalForDb.__financeDb ??
  new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: DATABASE_URL, max: 10 }),
    }),
  });

if (process.env.NODE_ENV !== "production") globalForDb.__financeDb = db;

export type Db = Kysely<Database>;
