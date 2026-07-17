# Finance Tracker

Self-hosted personal finance tracker: upload bank statements (PDF — scanned or digital — and CSV), get every transaction into a **local PostgreSQL database**, automatically categorized via merchant recognition, and ask an AI assistant questions about your money. Everything runs on your machine; the only external service is the Claude API for statement parsing, merchant lookup, and chat.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind + shadcn/ui
- **Local PostgreSQL** via Kysely + `pg` — no cloud database, no accounts, no auth
- **Claude API** (`claude-sonnet-5`) — statement extraction (native OCR via document input), merchant resolution with web search, chat agent with SQL-backed tools
- Statement files are stored on disk in `data/uploads/` (gitignored)

## Setup (macOS)

```bash
# 1. PostgreSQL (skip if already installed)
brew install postgresql@17
brew services start postgresql@17

# 2. Create the database
createdb finance_tracker

# 3. Configure
cp .env.example .env.local     # add your ANTHROPIC_API_KEY; DATABASE_URL default just works

# 4. Install, migrate, run
npm install
npm run db:migrate
npm run dev
```

Open http://localhost:3000 — you land straight on the dashboard (no login; it's your machine).

**Linux:** `sudo apt install postgresql` + `sudo -u postgres createdb -O $USER finance_tracker`, then set `DATABASE_URL` accordingly. **Docker alternative:** `docker run -d --name finance-pg -p 5432:5432 -e POSTGRES_DB=finance_tracker -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17` with `DATABASE_URL=postgresql://postgres@localhost:5432/finance_tracker`.

## How it works

- **Upload** a PDF/CSV → saved to `data/uploads/` → Claude extracts all transactions as structured JSON (dates, signed amounts, counterparty IBAN/name, balances) → deduplicated by content hash → inserted into Postgres. Re-uploading the same statement inserts zero duplicates.
- **CSV** column layouts are mapped once per bank format by Claude and cached (`csv_mappings`) — after the first file, CSV parsing costs nothing.
- **Categorization**: raw descriptors (e.g. `xxxxx-CARREFOUREXPRESS----`) are matched against a cached `merchants` table first; unknown merchants are identified once via Claude + web search, then cached forever.
- **Chat**: a Claude agent with typed SQL query tools — answers render as tables and charts, not plain text.
- **Insights**: after each import, rules detect recurring payments (propose tracking rent etc.), flag missed/doubled months, watch split-payment reimbursements, and spot unusual amounts.

## Database

- Migrations live in `db/migrations/*.sql`; `npm run db:migrate` applies pending ones (tracked in `_migrations`, idempotent).
- Inspect data any time with `psql finance_tracker`.
- Back up with `pg_dump finance_tracker > backup.sql`.

## Removing the old Supabase setup (one-time, if you followed earlier instructions)

- Delete the cloud project: supabase.com dashboard → your project → Settings → General → Delete project
- `brew uninstall supabase` — the CLI is no longer needed
- Remove the old Supabase lines from `.env.local` if you had added them
