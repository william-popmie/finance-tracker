#!/usr/bin/env node
// Minimal migration runner: applies db/migrations/*.sql in order, exactly
// once each, tracked in a _migrations table. Usage: npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/finance_tracker";
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
} catch (err) {
  if (err.code === "3D000") {
    console.error(
      `Database does not exist. Create it first:\n\n  createdb ${new URL(DATABASE_URL).pathname.slice(1) || "finance_tracker"}\n`
    );
  } else if (err.code === "ECONNREFUSED") {
    console.error(
      "PostgreSQL is not running. Start it (macOS/Homebrew):\n\n  brew services start postgresql@17\n"
    );
  } else {
    console.error(`Could not connect to ${DATABASE_URL}: ${err.message}`);
  }
  process.exit(1);
}

await client.query(
  `create table if not exists _migrations (
     name text primary key,
     applied_at timestamptz not null default now()
   )`
);

const applied = new Set(
  (await client.query("select name from _migrations")).rows.map((r) => r.name)
);

const files = (await readdir(MIGRATIONS_DIR))
  .filter((f) => f.endsWith(".sql"))
  .sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf-8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into _migrations (name) values ($1)", [file]);
    await client.query("commit");
    console.log(`applied  ${file}`);
    ran++;
  } catch (err) {
    await client.query("rollback");
    console.error(`FAILED   ${file}: ${err.message}`);
    process.exit(1);
  }
}

console.log(
  ran === 0 ? "Already up to date." : `Done — ${ran} migration(s) applied.`
);
await client.end();
