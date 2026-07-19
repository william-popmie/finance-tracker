// Deterministic "edition builder" for the front page (The Monthly Ledger).
//
// Everything a newspaper front page shows is composed here from the month's
// numbers — no AI, no randomness that changes between reloads. Given the
// already-fetched rows, buildEdition() returns a fully-composed Edition that
// the presentational components in frontpage/newspaper.tsx render verbatim.

import type { Category } from "@/lib/types";

export type MonthTxn = {
  booking_date: string;
  amount: number;
  category_id: string | null;
  description: string | null;
  counterparty_name: string | null;
  merchant_name: string | null;
  currency: string;
};

export type RecentTxn = {
  booking_date: string;
  amount: number;
  description: string | null;
  counterparty_name: string | null;
  merchant_name: string | null;
  currency: string;
};

export type WindowTxn = {
  booking_date: string;
  amount: number;
  category_id: string | null;
};

export type BuildInput = {
  now: Date;
  windowTx: WindowTxn[];
  monthTx: MonthTxn[];
  recentTx: RecentTxn[];
  categories: Category[];
  insights: { title: string; body: string | null }[];
  balanceToDate: number;
};

export type FigurePoint = { label: string; value: number; current: boolean };
export type Article = { kicker: string; headline: string; blurb: string };
export type MerchantRow = { name: string; amount: number };
export type TickerItem = { label: string; amount: number; currency: string };

export type Edition = {
  nameplate: { title: string; tagline: string };
  dateline: { volume: string; monthLabel: string; costLine: string };
  numbers: { spent: number; received: number; net: number; balance: number };
  lead: {
    kicker: string;
    headline: string;
    deck: string;
    body: string[];
    byline: string;
  };
  figure: FigurePoint[];
  articles: Article[];
  merchants: MerchantRow[];
  forecast: string;
  ticker: TickerItem[];
  hasActivity: boolean;
};

// Prose euros: no decimals, reads cleanly in a sentence ("€1,284").
function eur0(n: number): string {
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

// Calendar-month key from local components. Must NOT use toISOString(), which
// shifts the month across the UTC boundary and misaligns with the "YYYY-MM-DD"
// booking_date strings we compare against.
const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// Deterministic pick: stable per month, varies month to month.
function pick<T>(arr: T[], seed: number): T {
  return arr[((seed % arr.length) + arr.length) % arr.length];
}

function labelFor(t: {
  merchant_name: string | null;
  description: string | null;
  counterparty_name: string | null;
}): string {
  return (
    t.merchant_name ||
    t.description ||
    t.counterparty_name ||
    "Unknown"
  ).replace(/\s+/g, " ");
}

export function buildEdition(input: BuildInput): Edition {
  const { now, windowTx, monthTx, recentTx, categories, insights, balanceToDate } =
    input;

  const monthName = now.toLocaleString("en", { month: "long" });
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthName = prevDate.toLocaleString("en", { month: "long" });
  const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthName = nextDate.toLocaleString("en", { month: "long" });
  const seed = now.getMonth();

  const curKey = monthKey(now);
  const prevKey = monthKey(prevDate);

  // Top-level category resolution (mirrors the dashboard's topLevel()).
  const byId = new Map(categories.map((c) => [c.id, c]));
  const topLevel = (id: string | null): Category | null => {
    if (!id) return null;
    const c = byId.get(id);
    if (!c) return null;
    return c.parent_id ? byId.get(c.parent_id) ?? c : c;
  };

  // --- Monthly spend series (last 6 months) for Fig. 1 + MoM. ---
  const spendByMonth = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    spendByMonth.set(monthKey(d), 0);
  }
  for (const t of windowTx) {
    const key = t.booking_date.slice(0, 7);
    if (!spendByMonth.has(key)) continue;
    if (t.amount < 0) spendByMonth.set(key, spendByMonth.get(key)! + -t.amount);
  }
  const figure: FigurePoint[] = [...spendByMonth.entries()].map(([key, value]) => ({
    label: new Date(`${key}-01`).toLocaleString("en", { month: "short" }),
    value,
    current: key === curKey,
  }));

  const thisMonthSpend = spendByMonth.get(curKey) ?? 0;
  const prevMonthSpend = spendByMonth.get(prevKey) ?? 0;
  const pct =
    prevMonthSpend > 0
      ? (thisMonthSpend - prevMonthSpend) / prevMonthSpend
      : thisMonthSpend > 0
        ? 1
        : 0;

  // --- This month's numbers from the rich rows. ---
  let spent = 0;
  let received = 0;
  for (const t of monthTx) {
    if (t.amount < 0) spent += -t.amount;
    else received += t.amount;
  }
  const net = received - spent;

  // --- Spending by top-level category, this month and last. ---
  type CatAgg = { name: string; amount: number; count: number };
  const cats = new Map<string, CatAgg>();
  for (const t of monthTx) {
    if (t.amount >= 0) continue;
    const cat = topLevel(t.category_id);
    const name = cat?.name ?? "Uncategorized";
    const entry = cats.get(name) ?? { name, amount: 0, count: 0 };
    entry.amount += -t.amount;
    entry.count += 1;
    cats.set(name, entry);
  }
  const rankedCats = [...cats.values()].sort((a, b) => b.amount - a.amount);
  const topCat = rankedCats[0];

  // Prior-month spend per top-level category (for article MoM lines).
  const prevCatSpend = new Map<string, number>();
  for (const t of windowTx) {
    if (t.booking_date.slice(0, 7) !== prevKey || t.amount >= 0) continue;
    const cat = topLevel(t.category_id);
    const name = cat?.name ?? "Uncategorized";
    prevCatSpend.set(name, (prevCatSpend.get(name) ?? 0) + -t.amount);
  }

  // Top merchant within a given category name, this month.
  const topMerchantIn = (catName: string): MerchantRow | null => {
    const m = new Map<string, number>();
    for (const t of monthTx) {
      if (t.amount >= 0) continue;
      const name = topLevel(t.category_id)?.name ?? "Uncategorized";
      if (name !== catName) continue;
      const label = labelFor(t);
      m.set(label, (m.get(label) ?? 0) + -t.amount);
    }
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? { name: best[0], amount: best[1] } : null;
  };

  // --- Notable single expense (largest magnitude). ---
  let notable: { label: string; amount: number } | null = null;
  for (const t of monthTx) {
    if (t.amount >= 0) continue;
    if (!notable || -t.amount > notable.amount) {
      notable = { label: labelFor(t), amount: -t.amount };
    }
  }

  // --- Merchant "index" (top 4 by spend this month). ---
  const merchantSpend = new Map<string, number>();
  for (const t of monthTx) {
    if (t.amount >= 0) continue;
    const label = labelFor(t);
    merchantSpend.set(label, (merchantSpend.get(label) ?? 0) + -t.amount);
  }
  const merchants: MerchantRow[] = [...merchantSpend.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, amount]) => ({ name, amount }));

  // --- Lead story (templated). ---
  const pctStr = `${Math.abs(Math.round(pct * 100))}%`;
  const dir =
    pct > 0.02
      ? pick(["rose", "climbed"], seed)
      : pct < -0.02
        ? pick(["fell", "eased"], seed)
        : "held near";

  let headline: string;
  if (monthTx.length === 0) headline = `A Quiet ${monthName} on the Books`;
  else if (net < 0) headline = `${monthName} Ends in the Red`;
  else if (pct > 0.05 && topCat)
    headline = `${topCat.name} Lead a Costlier ${monthName}`;
  else if (pct < -0.05) headline = `A Leaner ${monthName} as Spending Eases`;
  else headline = `A Steady ${monthName} on the Books`;

  // Phrase the month-over-month change, keeping runaway percentages readable.
  const changePhrase =
    prevMonthSpend <= 0
      ? `reached ${eur0(thisMonthSpend)}`
      : pct > 1
        ? `more than doubled to ${eur0(thisMonthSpend)}`
        : `${dir} ${pctStr} to ${eur0(thisMonthSpend)}`;

  const deck =
    monthTx.length === 0
      ? `No entries have been recorded for ${monthName} yet.`
      : `Spending ${changePhrase}${
          notable ? `, with a ${eur0(notable.amount)} ${notable.label} charge the month's largest` : ""
        }.`;

  const body: string[] = [];
  if (monthTx.length > 0) {
    let s1 =
      net >= 0
        ? `${monthName} closed ${eur0(net)} in surplus.`
        : `${monthName} closed ${eur0(-net)} in the red.`;
    if (topCat) {
      s1 += ` ${topCat.name} alone reached ${eur0(topCat.amount)} across ${
        topCat.count
      } ${topCat.count === 1 ? "charge" : "charges"}.`;
    }
    body.push(s1);
    const s2 = `Income ${
      received > 0 ? `held at ${eur0(received)}` : "was quiet"
    } this month, leaving a running balance of ${eur0(balanceToDate)}.`;
    body.push(s2);
  } else {
    body.push(
      `Upload a statement to see ${monthName} written up here, with the month's story drawn straight from your transactions.`
    );
  }

  // --- Category "articles" (top 4). ---
  const articles: Article[] = rankedCats.slice(0, 4).map((c) => {
    const merchant = topMerchantIn(c.name);
    const prev = prevCatSpend.get(c.name) ?? 0;
    let blurb = merchant
      ? `${merchant.name} took the largest share at ${eur0(merchant.amount)}.`
      : "";
    const sep = blurb ? " " : "";
    if (prev > 0) {
      const cp = Math.round(((c.amount - prev) / prev) * 100);
      blurb +=
        Math.abs(cp) > 150
          ? `${sep}${cp > 0 ? "Well above" : "Well below"} ${prevMonthName}.`
          : `${sep}${cp >= 0 ? "Up" : "Down"} ${Math.abs(cp)}% on ${prevMonthName}.`;
    } else {
      blurb += `${sep}New activity this ${monthName}.`;
    }
    return {
      kicker: c.name,
      headline: `${eur0(c.amount)} Across ${c.count} ${
        c.count === 1 ? "Charge" : "Charges"
      }`,
      blurb,
    };
  });

  // --- Forecast (reuse an open insight, else templated). ---
  const insight = insights[0];
  const forecast = insight?.title
    ? insight.body
      ? `${insight.title} — ${insight.body}`
      : insight.title
    : net >= 0
      ? `Surplus should continue into ${nextMonthName} if spending holds its line.`
      : `Trimming discretionary spending would bring ${nextMonthName} back to balance.`;

  // --- Ticker (recent activity). ---
  const ticker: TickerItem[] = recentTx.map((t) => ({
    label: labelFor(t),
    amount: t.amount,
    currency: t.currency,
  }));

  return {
    nameplate: {
      title: "The Monthly Ledger",
      tagline: "Your money, in black and white",
    },
    dateline: {
      volume: `Vol. ${now.getFullYear() - 2023} · No. ${now.getMonth() + 1}`,
      monthLabel: `${monthName} ${now.getFullYear()}`,
      costLine: eur0(spent),
    },
    numbers: { spent, received, net, balance: balanceToDate },
    lead: {
      kicker: "Household Finance · Lead",
      headline,
      deck,
      body,
      byline: "By the Ledger Desk",
    },
    figure,
    articles,
    merchants,
    forecast,
    ticker,
    hasActivity: monthTx.length > 0,
  };
}
