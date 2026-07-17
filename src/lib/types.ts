// Hand-written row types for the finance-tracker schema (single-user, local).

export type Account = {
  id: string;
  iban: string | null;
  name: string;
  bank: string | null;
  created_at: string;
};

export type Statement = {
  id: string;
  account_id: string | null;
  storage_path: string;
  file_name: string;
  file_type: "pdf" | "csv";
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  status: "uploaded" | "parsing" | "parsed" | "error";
  error_msg: string | null;
  transaction_count: number | null;
  created_at: string;
};

export type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
};

export type Merchant = {
  id: string;
  canonical_name: string;
  parent_brand: string | null;
  website: string | null;
  default_category_id: string | null;
  match_patterns: string[];
  created_at: string;
};

export type Transaction = {
  id: string;
  account_id: string;
  statement_id: string | null;
  booking_date: string;
  value_date: string | null;
  amount: number;
  currency: string;
  raw_description: string;
  counterparty_iban: string | null;
  counterparty_name: string | null;
  merchant_id: string | null;
  category_id: string | null;
  description: string | null;
  tags: string[];
  notes: string | null;
  dedupe_hash: string;
  created_at: string;
};

export type TransactionWithRelations = Transaction & {
  accounts: Pick<Account, "name" | "iban"> | null;
  categories: Pick<Category, "name" | "color" | "parent_id"> | null;
  merchants: Pick<Merchant, "canonical_name"> | null;
};

export type Expectation = {
  id: string;
  kind: "recurring" | "reimbursement";
  label: string;
  merchant_id: string | null;
  expected_amount: number | null;
  cadence: "weekly" | "monthly" | "quarterly" | "yearly" | null;
  counterpart_count: number | null;
  anchor_transaction_id: string | null;
  status: "proposed" | "active" | "paused" | "done";
  notes: string | null;
  created_at: string;
};

export type Insight = {
  id: string;
  type: string;
  severity: "info" | "warning" | "alert";
  title: string;
  body: string | null;
  related_transaction_ids: string[];
  expectation_id: string | null;
  status: "open" | "dismissed" | "resolved";
  created_at: string;
};
