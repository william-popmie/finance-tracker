import type { Db } from "@/lib/db";
import type { CategorizationRun } from "@/lib/types";
import { runCategorization } from "./categorize";
import { runInsightPass } from "@/lib/insights/engine";
import { log, logError } from "@/lib/log";

// A run's updated_at is touched on every progress callback (at least once per
// ~15-transaction batch). A "running" row that hasn't moved in STALE_MS was
// interrupted (dev server killed/restarted) and gets reaped to error.
const STALE_MS = 3 * 60_000;

export async function reapStaleRuns(db: Db): Promise<void> {
  const reaped = await db
    .updateTable("categorization_runs")
    .set({
      status: "error",
      error_msg: "Interrupted (server restarted?)",
      finished_at: new Date().toISOString(),
    })
    .where("status", "=", "running")
    .where("updated_at", "<", new Date(Date.now() - STALE_MS).toISOString())
    .returning("id")
    .execute();
  for (const r of reaped) {
    log("runs", `reaped stale run ${r.id} — marked as interrupted`);
  }
}

export async function getLatestRun(db: Db): Promise<CategorizationRun | null> {
  await reapStaleRuns(db);
  const run = await db
    .selectFrom("categorization_runs")
    .selectAll()
    .orderBy("started_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return (run as CategorizationRun | undefined) ?? null;
}

/**
 * Start a new run unless a live (non-stale) one exists. Returns null when a
 * run is already in progress.
 */
export async function startRun(
  db: Db,
  trigger: "import" | "manual"
): Promise<CategorizationRun | null> {
  await reapStaleRuns(db);

  const active = await db
    .selectFrom("categorization_runs")
    .select("id")
    .where("status", "=", "running")
    .executeTakeFirst();
  if (active) {
    log("runs", `start (${trigger}) rejected — run ${active.id} already in progress`);
    return null;
  }

  const { total } = await db
    .selectFrom("transactions")
    .select((eb) => eb.fn.countAll<number>().as("total"))
    .where("category_id", "is", null)
    .executeTakeFirstOrThrow();

  const run = await db
    .insertInto("categorization_runs")
    .values({ trigger, total })
    .returningAll()
    .executeTakeFirstOrThrow();
  log("runs", `started run ${run.id} (${trigger}), ${total} uncategorized transactions`);
  return run as CategorizationRun;
}

/**
 * Execute a started run: categorization with progress heartbeats, then the
 * insight pass. Every outcome is persisted and logged — nothing fails silently.
 */
export async function executeRun(db: Db, run: CategorizationRun): Promise<void> {
  try {
    let progressCalls = 0;
    const result = await runCategorization(db, async (p) => {
      await db
        .updateTable("categorization_runs")
        .set({
          pattern_matched: p.patternMatched,
          ai_resolved: p.aiResolved,
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", run.id)
        .execute();
      // The categorize engine already narrates per record — only echo run
      // progress every 10th update to keep the terminal readable.
      if (progressCalls++ % 10 === 0) {
        log(
          "runs",
          `run ${run.id} progress: ${p.patternMatched} pattern-matched, ${p.aiResolved} AI-resolved of ${run.total}`
        );
      }
    });

    await db
      .updateTable("categorization_runs")
      .set({
        status: "done",
        pattern_matched: result.patternMatched,
        ai_resolved: result.aiResolved,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .where("id", "=", run.id)
      .execute();
    log(
      "runs",
      `run ${run.id} done: ${result.patternMatched} pattern-matched, ${result.aiResolved} AI-resolved`
    );
  } catch (err) {
    logError("runs", `run ${run.id} failed`, err);
    await db
      .updateTable("categorization_runs")
      .set({
        status: "error",
        error_msg: err instanceof Error ? err.message : String(err),
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .where("id", "=", run.id)
      .execute();
  }

  try {
    log("insights", "insight pass started");
    await runInsightPass(db);
    log("insights", "insight pass finished");
  } catch (err) {
    logError("insights", "insight pass failed", err);
  }
}
