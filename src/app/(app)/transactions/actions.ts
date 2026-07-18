"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { sanitizeMatchPattern } from "@/lib/ai/categorize";
import { log } from "@/lib/log";

export type UpdateTransactionInput = {
  id: string;
  categoryId: string | null;
  merchantName: string | null;
  tags: string[];
  notes: string | null;
  applyToAll: boolean;
  /** Total people the payment is split across (incl. the user) — creates a
   * reimbursement expectation that watches for incoming repayments. */
  splitCount: number | null;
};

export async function updateTransaction(input: UpdateTransactionInput) {
  const tx = await db
    .selectFrom("transactions")
    .select(["raw_description", "description"])
    .where("id", "=", input.id)
    .executeTakeFirst();

  // Resolve merchant by name (find-or-create); empty name clears the merchant.
  // Manual edits feed Layer-1 matching: derive a match pattern from the raw
  // descriptor so future imports of this merchant categorize for free.
  let merchantId: string | null = null;
  const name = input.merchantName?.trim();
  if (name && tx) {
    const pattern = sanitizeMatchPattern(name, tx.raw_description);
    const existing = await db
      .selectFrom("merchants")
      .select(["id", "match_patterns", "default_category_id"])
      .where("canonical_name", "ilike", name)
      .executeTakeFirst();
    if (existing) {
      merchantId = existing.id;
      const patterns = new Set<string>(existing.match_patterns ?? []);
      if (pattern) patterns.add(pattern);
      await db
        .updateTable("merchants")
        .set({
          match_patterns: [...patterns],
          default_category_id: existing.default_category_id ?? input.categoryId,
        })
        .where("id", "=", existing.id)
        .execute();
    } else {
      const created = await db
        .insertInto("merchants")
        .values({
          canonical_name: name,
          default_category_id: input.categoryId,
          match_patterns: pattern ? [pattern] : [],
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      merchantId = created.id;
    }
    log(
      "edit",
      `merchant "${name}" ${existing ? "updated" : "created"}${pattern ? ` with pattern "${pattern}"` : ""}`
    );
  }

  await db
    .updateTable("transactions")
    .set({
      category_id: input.categoryId,
      merchant_id: merchantId,
      tags: input.tags,
      notes: input.notes || null,
      // Give the row a clean display name if it never got one.
      ...(name && tx && !tx.description ? { description: name } : {}),
    })
    .where("id", "=", input.id)
    .execute();

  // "Apply to all": this category becomes the merchant's default and
  // backfills every transaction from the same merchant.
  if (input.applyToAll && merchantId && input.categoryId) {
    await db
      .updateTable("merchants")
      .set({ default_category_id: input.categoryId })
      .where("id", "=", merchantId)
      .execute();
    await db
      .updateTable("transactions")
      .set({ category_id: input.categoryId })
      .where("merchant_id", "=", merchantId)
      .execute();
  }

  // Split payment: create a reimbursement expectation (one per transaction).
  if (input.splitCount && input.splitCount >= 2) {
    const tx = await db
      .selectFrom("transactions")
      .select(["amount", "description", "counterparty_name", "raw_description"])
      .where("id", "=", input.id)
      .executeTakeFirst();
    if (tx) {
      const existing = await db
        .selectFrom("expectations")
        .select("id")
        .where("anchor_transaction_id", "=", input.id)
        .where("kind", "=", "reimbursement")
        .executeTakeFirst();
      const share = Number(
        (Math.abs(Number(tx.amount)) / input.splitCount).toFixed(2)
      );
      const label =
        tx.description || tx.counterparty_name || tx.raw_description.slice(0, 60);
      if (!existing) {
        await db
          .insertInto("expectations")
          .values({
            kind: "reimbursement",
            label: `Split: ${label}`,
            expected_amount: share,
            counterpart_count: input.splitCount - 1,
            anchor_transaction_id: input.id,
            status: "active",
          })
          .execute();
      }
    }
  }

  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}

export async function deleteTransactions(ids: string[]) {
  if (ids.length === 0) return;
  await db.deleteFrom("transactions").where("id", "in", ids).execute();
  log("edit", `deleted ${ids.length} transaction${ids.length === 1 ? "" : "s"}`);
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}
