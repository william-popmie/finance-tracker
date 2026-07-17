"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

export async function setInsightStatus(
  id: string,
  status: "dismissed" | "resolved"
) {
  await db.updateTable("insights").set({ status }).where("id", "=", id).execute();
  revalidatePath("/dashboard");
}

export async function setExpectationStatus(
  id: string,
  status: "active" | "paused" | "done"
) {
  await db
    .updateTable("expectations")
    .set({ status })
    .where("id", "=", id)
    .execute();
  revalidatePath("/dashboard");
}

export async function deleteExpectation(id: string) {
  await db.deleteFrom("expectations").where("id", "=", id).execute();
  revalidatePath("/dashboard");
}
