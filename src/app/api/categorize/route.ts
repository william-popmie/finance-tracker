import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { startRun, executeRun, getLatestRun } from "@/lib/ai/categorization-runs";

export const maxDuration = 300;

// Start a categorization run in the background. 409 when one is already live.
export async function POST() {
  const run = await startRun(db, "manual");
  if (!run) {
    return NextResponse.json(
      { error: "A categorization run is already in progress" },
      { status: 409 }
    );
  }
  after(() => executeRun(db, run));
  return NextResponse.json({ runId: run.id });
}

// Status endpoint polled by the transactions page.
export async function GET() {
  const run = await getLatestRun(db);
  const { uncategorized } = await db
    .selectFrom("transactions")
    .select((eb) => eb.fn.countAll<number>().as("uncategorized"))
    .where("category_id", "is", null)
    .executeTakeFirstOrThrow();
  const { total } = await db
    .selectFrom("transactions")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .executeTakeFirstOrThrow();
  return NextResponse.json({ run, uncategorized, total });
}
