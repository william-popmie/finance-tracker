"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { deleteUpload } from "@/lib/storage";
import { log, logError } from "@/lib/log";

/**
 * Delete statements including their imported transactions and stored files
 * (user decision: deleting a statement is a full cleanup for re-testing).
 */
export async function deleteStatements(ids: string[]) {
  if (ids.length === 0) return;

  const statements = await db
    .selectFrom("statements")
    .select(["id", "storage_path", "file_name"])
    .where("id", "in", ids)
    .execute();

  await db.deleteFrom("transactions").where("statement_id", "in", ids).execute();
  await db.deleteFrom("statements").where("id", "in", ids).execute();

  for (const s of statements) {
    try {
      await deleteUpload(s.storage_path);
    } catch (err) {
      logError("upload", `failed to delete file for ${s.file_name}`, err);
    }
  }
  log(
    "upload",
    `deleted ${statements.length} statement${statements.length === 1 ? "" : "s"} (+ transactions + files)`
  );

  revalidatePath("/upload");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}
