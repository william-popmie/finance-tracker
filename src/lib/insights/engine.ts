import type { Db } from "@/lib/db";

/**
 * Insight engine — rule-based detection that runs after every import.
 *
 * 1. Detects recurring outgoing payments (same counterpart, ~same amount,
 *    ~monthly) and proposes `expectations` the user can confirm.
 * 2. Checks active/proposed recurring expectations for missing or doubled
 *    months → `insights`.
 * 3. Checks reimbursement expectations (split payments) for missing
 *    repayments → `insights`.
 * 4. Flags unusually large payments vs a merchant's history.
 */

type Tx = {
  id: string;
  booking_date: string;
  amount: number;
  merchant_id: string | null;
  counterparty_iban: string | null;
  counterparty_name: string | null;
  description: string | null;
  raw_description: string;
};

type Expectation = {
  id: string;
  kind: "recurring" | "reimbursement";
  label: string;
  merchant_id: string | null;
  expected_amount: number | null;
  cadence: string | null;
  counterpart_count: number | null;
  anchor_transaction_id: string | null;
  status: string;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

function recurringKey(t: Tx): string | null {
  if (t.merchant_id) return `merchant:${t.merchant_id}`;
  if (t.counterparty_iban) return `iban:${t.counterparty_iban}`;
  if (t.counterparty_name) {
    return `name:${t.counterparty_name.trim().toLowerCase()}`;
  }
  return null;
}

async function insightExists(
  db: Db,
  filter: { type: string; expectationId?: string; relatedTxId?: string; titleContains?: string }
): Promise<boolean> {
  let query = db
    .selectFrom("insights")
    .select((eb) => eb.fn.countAll().as("count"))
    .where("type", "=", filter.type)
    .where("status", "!=", "resolved");
  if (filter.expectationId) {
    query = query.where("expectation_id", "=", filter.expectationId);
  }
  if (filter.relatedTxId) {
    query = query.where("related_transaction_ids", "@>", [filter.relatedTxId]);
  }
  if (filter.titleContains) {
    query = query.where("title", "ilike", `%${filter.titleContains}%`);
  }
  const row = await query.executeTakeFirst();
  return Number(row?.count ?? 0) > 0;
}

export async function runInsightPass(
  db: Db
): Promise<{ proposedExpectations: number; newInsights: number }> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const sinceIso = twelveMonthsAgo.toISOString().slice(0, 10);

  const [txs, expectations, merchantData] = await Promise.all([
    db
      .selectFrom("transactions")
      .select([
        "id",
        "booking_date",
        "amount",
        "merchant_id",
        "counterparty_iban",
        "counterparty_name",
        "description",
        "raw_description",
      ])
      .where("booking_date", ">=", sinceIso)
      .orderBy("booking_date", "asc")
      .execute() as Promise<Tx[]>,
    db.selectFrom("expectations").selectAll().execute() as Promise<Expectation[]>,
    db.selectFrom("merchants").select(["id", "canonical_name"]).execute(),
  ]);

  const merchantNames = new Map(merchantData.map((m) => [m.id, m.canonical_name]));
  if (txs.length === 0) return { proposedExpectations: 0, newInsights: 0 };

  const lastDataMonth = monthOf(txs[txs.length - 1].booking_date);
  let proposedExpectations = 0;
  let newInsights = 0;

  const addInsight = async (insight: {
    type: string;
    severity: "info" | "warning" | "alert";
    title: string;
    body: string;
    related_transaction_ids?: string[];
    expectation_id?: string;
  }) => {
    try {
      await db.insertInto("insights").values(insight).execute();
      newInsights++;
    } catch (err) {
      console.error("Insight insert failed:", err);
    }
  };

  // ---------------------------------------------------------------------
  // 1. Detect recurring outgoing payments → propose expectations.
  // ---------------------------------------------------------------------
  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const key = recurringKey(t);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const amounts = list.map((t) => Math.abs(t.amount));
    const med = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - med) / med <= 0.15);
    if (stable.length < 3) continue;

    const months = new Set(list.map((t) => monthOf(t.booking_date)));
    if (months.size < 3) continue;
    // Roughly monthly: distinct months ≈ number of stable payments.
    if (months.size < stable.length - 1) continue;

    const merchantId = key.startsWith("merchant:") ? key.slice(9) : null;
    const label = merchantId
      ? (merchantNames.get(merchantId) ?? "Recurring payment")
      : (list[0].counterparty_name ??
        list[0].description ??
        "Recurring payment");

    const already = expectations.some(
      (e) =>
        e.kind === "recurring" &&
        ((merchantId && e.merchant_id === merchantId) ||
          e.label.toLowerCase() === label.toLowerCase())
    );
    if (already) continue;

    try {
      await db
        .insertInto("expectations")
        .values({
          kind: "recurring",
          label,
          merchant_id: merchantId,
          expected_amount: Number(med.toFixed(2)),
          cadence: "monthly",
          status: "proposed",
        })
        .execute();
      proposedExpectations++;
    } catch (err) {
      console.error("Expectation insert failed:", err);
    }
  }

  // ---------------------------------------------------------------------
  // 2. Recurring expectations: missing / doubled months.
  // ---------------------------------------------------------------------
  for (const exp of expectations) {
    if (exp.kind !== "recurring" || !["active", "proposed"].includes(exp.status)) {
      continue;
    }

    const matches = txs.filter((t) => {
      if (t.amount >= 0) return false;
      const byMerchant = exp.merchant_id && t.merchant_id === exp.merchant_id;
      const byAmount =
        exp.expected_amount != null &&
        Math.abs(Math.abs(t.amount) - exp.expected_amount) / exp.expected_amount <= 0.15;
      const byName =
        t.counterparty_name?.toLowerCase().includes(exp.label.toLowerCase()) ??
        false;
      return byMerchant ? byAmount || true : byAmount && byName;
    });
    if (matches.length === 0) continue;

    const paidMonths = new Map<string, Tx[]>();
    for (const t of matches) {
      const m = monthOf(t.booking_date);
      paidMonths.set(m, [...(paidMonths.get(m) ?? []), t]);
    }

    const firstMonth = monthOf(matches[0].booking_date);
    const checkMonths = monthsBetween(firstMonth, lastDataMonth);

    for (const month of checkMonths) {
      const inMonth = paidMonths.get(month) ?? [];
      if (inMonth.length === 0 && month !== lastDataMonth) {
        // Skip the current data month — the payment may simply not be due yet.
        if (await insightExists(db, {
          type: "missed_recurring",
          expectationId: exp.id,
          titleContains: month,
        })) continue;
        await addInsight({
          type: "missed_recurring",
          severity: "warning",
          title: `Possible missed payment: ${exp.label} in ${month}`,
          body: `No ${exp.label} payment (~€${exp.expected_amount ?? "?"}) found in ${month}, while surrounding months have one. Check whether it was paid another way or genuinely missed.`,
          expectation_id: exp.id,
        });
      }
      if (inMonth.length > 1) {
        if (await insightExists(db, {
          type: "double_recurring",
          expectationId: exp.id,
          titleContains: month,
        })) continue;
        await addInsight({
          type: "double_recurring",
          severity: "warning",
          title: `${exp.label} paid ${inMonth.length}× in ${month}`,
          body: `Found ${inMonth.length} matching payments in ${month} for a monthly expectation — possibly a double payment or a catch-up for a missed month.`,
          related_transaction_ids: inMonth.map((t) => t.id),
          expectation_id: exp.id,
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // 3. Reimbursement expectations: who still owes money?
  // ---------------------------------------------------------------------
  for (const exp of expectations) {
    if (exp.kind !== "reimbursement" || exp.status !== "active") continue;
    if (!exp.expected_amount || !exp.counterpart_count) continue;

    const anchor = exp.anchor_transaction_id
      ? txs.find((t) => t.id === exp.anchor_transaction_id)
      : null;
    const sinceDate = anchor?.booking_date ?? sinceIso;

    const repayments = txs.filter(
      (t) =>
        t.amount > 0 &&
        t.booking_date >= sinceDate &&
        Math.abs(t.amount - exp.expected_amount!) / exp.expected_amount! <= 0.05
    );

    if (repayments.length >= exp.counterpart_count) {
      await db
        .updateTable("expectations")
        .set({ status: "done" })
        .where("id", "=", exp.id)
        .execute();
      await db
        .updateTable("insights")
        .set({ status: "resolved" })
        .where("expectation_id", "=", exp.id)
        .where("type", "=", "missing_reimbursement")
        .execute();
      continue;
    }

    const missing = exp.counterpart_count - repayments.length;
    const anchorAge = anchor
      ? (Date.now() - new Date(anchor.booking_date).getTime()) / 86400000
      : 999;
    if (anchorAge < 7) continue; // give people a week before flagging

    if (await insightExists(db, {
      type: "missing_reimbursement",
      expectationId: exp.id,
    })) continue;
    await addInsight({
      type: "missing_reimbursement",
      severity: "info",
      title: `${exp.label}: still missing ${missing} of ${exp.counterpart_count} repayments`,
      body: `Expecting ${exp.counterpart_count} incoming payments of ~€${exp.expected_amount} for "${exp.label}". ${repayments.length} received so far.`,
      related_transaction_ids: repayments.map((t) => t.id),
      expectation_id: exp.id,
    });
  }

  // ---------------------------------------------------------------------
  // 4. Unusually large payment vs merchant history (recent txns only).
  // ---------------------------------------------------------------------
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - 35);
  const recentIso = recentCutoff.toISOString().slice(0, 10);

  const byMerchant = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount >= 0 || !t.merchant_id) continue;
    byMerchant.set(t.merchant_id, [...(byMerchant.get(t.merchant_id) ?? []), t]);
  }
  for (const [merchantId, list] of byMerchant) {
    if (list.length < 5) continue;
    const med = median(list.map((t) => Math.abs(t.amount)));
    if (med < 5) continue;
    for (const t of list) {
      if (t.booking_date < recentIso) continue;
      if (Math.abs(t.amount) < med * 2.5 || Math.abs(t.amount) - med < 25) continue;
      if (await insightExists(db, { type: "unusual_amount", relatedTxId: t.id })) {
        continue;
      }
      const name = merchantNames.get(merchantId) ?? "this merchant";
      await addInsight({
        type: "unusual_amount",
        severity: "info",
        title: `Unusually large payment at ${name}`,
        body: `€${Math.abs(t.amount).toFixed(2)} on ${t.booking_date} — your typical payment there is around €${med.toFixed(2)}.`,
        related_transaction_ids: [t.id],
      });
    }
  }

  return { proposedExpectations, newInsights };
}
