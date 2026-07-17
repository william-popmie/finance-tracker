"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

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
  // Resolve merchant by name (find-or-create); empty name clears the merchant.
  let merchantId: string | null = null;
  const name = input.merchantName?.trim();
  if (name) {
    const existing = await db
      .selectFrom("merchants")
      .select("id")
      .where("canonical_name", "ilike", name)
      .executeTakeFirst();
    if (existing) {
      merchantId = existing.id;
    } else {
      const created = await db
        .insertInto("merchants")
        .values({ canonical_name: name, default_category_id: input.categoryId })
        .returning("id")
        .executeTakeFirstOrThrow();
      merchantId = created.id;
    }
  }

  await db
    .updateTable("transactions")
    .set({
      category_id: input.categoryId,
      merchant_id: merchantId,
      tags: input.tags,
      notes: input.notes || null,
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
