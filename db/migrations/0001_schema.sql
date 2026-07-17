-- Finance Tracker schema (single-user, local PostgreSQL).

create extension if not exists pgcrypto; -- gen_random_uuid on older PG versions

create table accounts (
  id uuid primary key default gen_random_uuid(),
  iban text unique,
  name text not null,
  bank text,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references categories(id) on delete cascade,
  icon text,
  color text,
  unique (name, parent_id)
);

create table merchants (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  parent_brand text,
  website text,
  default_category_id uuid references categories(id) on delete set null,
  match_patterns text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table statements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('pdf', 'csv')),
  period_start date,
  period_end date,
  opening_balance numeric(14,2),
  closing_balance numeric(14,2),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsing', 'parsed', 'error')),
  error_msg text,
  transaction_count integer,
  created_at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  statement_id uuid references statements(id) on delete set null,
  booking_date date not null,
  value_date date,
  amount numeric(14,2) not null, -- signed: negative = money out
  currency text not null default 'EUR',
  raw_description text not null,
  counterparty_iban text,
  counterparty_name text,
  merchant_id uuid references merchants(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  description text, -- AI-cleaned human description
  tags text[] not null default '{}',
  notes text,
  dedupe_hash text not null,
  created_at timestamptz not null default now(),
  unique (account_id, dedupe_hash)
);

create index transactions_booking_date_idx on transactions (booking_date desc);
create index transactions_category_idx on transactions (category_id);
create index transactions_merchant_idx on transactions (merchant_id);

create table csv_mappings (
  id uuid primary key default gen_random_uuid(),
  header_hash text not null unique,
  mapping jsonb not null,
  created_at timestamptz not null default now()
);

create table expectations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('recurring', 'reimbursement')),
  label text not null,
  merchant_id uuid references merchants(id) on delete set null,
  expected_amount numeric(14,2),
  cadence text check (cadence in ('weekly', 'monthly', 'quarterly', 'yearly')),
  counterpart_count integer, -- reimbursements: how many people should pay back
  anchor_transaction_id uuid references transactions(id) on delete set null,
  status text not null default 'active'
    check (status in ('proposed', 'active', 'paused', 'done')),
  notes text,
  created_at timestamptz not null default now()
);

create table insights (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'alert')),
  title text not null,
  body text,
  related_transaction_ids uuid[] not null default '{}',
  expectation_id uuid references expectations(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'dismissed', 'resolved')),
  created_at timestamptz not null default now()
);

create table chat_conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  created_at timestamptz not null default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index chat_messages_conversation_idx on chat_messages (conversation_id, created_at);
