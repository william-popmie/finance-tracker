-- Categorization runs: persisted status/progress for background categorization,
-- with a heartbeat (updated_at) so interrupted runs are detectable.

create table categorization_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running'
    check (status in ('running', 'done', 'error')),
  trigger text not null check (trigger in ('import', 'manual')),
  total integer not null default 0,
  pattern_matched integer not null default 0,
  ai_resolved integer not null default 0,
  error_msg text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Stable bank reference (BNP "Bankreferentie") parsed from descriptors,
-- used as a secondary duplicate check alongside dedupe_hash.
alter table transactions add column bank_reference text;
create index transactions_bank_reference_idx
  on transactions (account_id, bank_reference)
  where bank_reference is not null;
