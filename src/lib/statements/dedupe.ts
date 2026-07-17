import { createHash } from "crypto";
import type { ExtractedTransaction } from "@/lib/ai/extract";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Stable hash per transaction so re-importing the same statement (or an
 * overlapping export) inserts zero duplicates. Identical rows *within* one
 * import get an occurrence index so legitimate same-day/same-amount
 * duplicates survive.
 */
export function withDedupeHashes(
  transactions: ExtractedTransaction[]
): { tx: ExtractedTransaction; dedupe_hash: string }[] {
  const seen = new Map<string, number>();
  return transactions.map((tx) => {
    const base = `${tx.booking_date}|${tx.amount.toFixed(2)}|${tx.raw_description}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { tx, dedupe_hash: sha256(`${base}|${occurrence}`) };
  });
}
