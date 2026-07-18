-- Cached default tags so Layer-1 pattern matches get tags for free.
alter table merchants add column default_tags text[] not null default '{}';

-- Guard for concurrent per-record merchant upserts (parallel workers may try
-- to create the same merchant). Safe on a fresh/reset DB; if applied to a
-- dirty DB with case-duplicate names, dedupe those rows first.
create unique index merchants_canonical_name_lower_uniq
  on merchants (lower(canonical_name));
