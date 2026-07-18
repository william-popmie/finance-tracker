// Reset all user data for a clean test cycle. Keeps the category taxonomy
// and applied migrations; everything else (transactions, statements,
// merchants, runs, chat, uploaded files) is wiped.
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/finance_tracker";

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  await client.query(`truncate table
    transactions, statements, merchants, categorization_runs,
    csv_mappings, expectations, insights,
    chat_conversations, chat_messages, accounts
    restart identity cascade`);
  console.log("database: truncated (categories and migrations kept)");
} finally {
  await client.end();
}

const uploadDir = path.join(process.cwd(), "data", "uploads");
const files = await readdir(uploadDir).catch(() => []);
for (const f of files) {
  await rm(path.join(uploadDir, f), { force: true });
}
console.log(`uploads: deleted ${files.length} stored file(s)`);
console.log("Reset done.");
