import type { FunctionDeclaration } from "@google/genai";
import { sql } from "kysely";
import type { Db } from "@/lib/db";
import type { Category } from "@/lib/types";
import type {
  AggregateBucket,
  AggregateResult,
  QueryTransactionsResult,
  ToolRenderData,
  TxRow,
} from "./types";

/**
 * Chat agent tools. Each tool runs a typed Postgres query — SQL does the
 * aggregation work, the model does the reasoning. Tool results return two
 * shapes: `forModel` (compact JSON for Claude) and `render` (payload the UI
 * turns into tables/charts).
 */

const FILTER_PROPS = {
  from: {
    anyOf: [{ type: "string" }, { type: "null" }],
    description: "Start date YYYY-MM-DD (inclusive)",
  },
  to: {
    anyOf: [{ type: "string" }, { type: "null" }],
    description: "End date YYYY-MM-DD (inclusive)",
  },
  category: {
    anyOf: [{ type: "string" }, { type: "null" }],
    description:
      "Category name (top-level like 'Groceries' includes its subcategories)",
  },
  merchant: {
    anyOf: [{ type: "string" }, { type: "null" }],
    description: "Merchant name (partial match)",
  },
  tag: {
    anyOf: [{ type: "string" }, { type: "null" }],
    description: "Exact tag",
  },
  text: {
    anyOf: [{ type: "string" }, { type: "null" }],
    description: "Free-text search over descriptions and counterparty names",
  },
  direction: {
    type: "string",
    enum: ["in", "out", "all"],
    description: "'out' = spending only, 'in' = incoming only",
  },
  min_amount: {
    anyOf: [{ type: "number" }, { type: "null" }],
    description: "Minimum absolute amount in EUR",
  },
  max_amount: {
    anyOf: [{ type: "number" }, { type: "null" }],
    description: "Maximum absolute amount in EUR",
  },
} as const;

const FILTER_REQUIRED = [
  "from",
  "to",
  "category",
  "merchant",
  "tag",
  "text",
  "direction",
  "min_amount",
  "max_amount",
];

export const CHAT_TOOLS: FunctionDeclaration[] = [
  {
    name: "query_transactions",
    description:
      "List individual transactions matching filters, newest first. Use this when the user wants to see specific transactions. Returns `limit` rows (default 50, max 200) starting at `offset`, plus total_count/total_amount/total_spent/total_received computed over ALL matches. If truncated=true and the user asked for a full list, call again with a higher limit or offset to page through.",
    parametersJsonSchema: {
      type: "object",
      required: FILTER_REQUIRED,
      properties: {
        ...FILTER_PROPS,
        limit: {
          anyOf: [{ type: "number" }, { type: "null" }],
          description: "Max rows to return (default 50, max 200)",
        },
        offset: {
          anyOf: [{ type: "number" }, { type: "null" }],
          description: "Rows to skip, for paging (default 0)",
        },
      },
    },
  },
  {
    name: "aggregate_transactions",
    description:
      "Sum and count transactions grouped by category, merchant, month, or tag — use this for 'how much did I spend on X' questions and for spotting missing months in recurring payments (group_by: 'month'). Aggregates over ALL matching transactions in SQL. Returns up to 30 buckets plus bucket_count (the true number of groups; if larger, the list is truncated).",
    parametersJsonSchema: {
      type: "object",
      required: ["group_by", ...FILTER_REQUIRED],
      properties: {
        group_by: {
          type: "string",
          enum: ["category", "merchant", "month", "tag"],
        },
        ...FILTER_PROPS,
      },
    },
  },
  {
    name: "list_categories",
    description:
      "List the category taxonomy (category paths) so filters use exact names.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "search_merchants",
    description:
      "Find known merchants by name (partial match) — useful to resolve what the user calls a shop into the exact merchant name.",
    parametersJsonSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
      },
    },
  },
  {
    name: "get_open_insights",
    description:
      "List the system's open proactive flags (missed recurring payments, doubled payments, missing reimbursements, unusual amounts). Check these when the user asks about missed rent, pending repayments, or anything the tracker might already have flagged.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "list_expectations",
    description:
      "List tracked expectations: recurring payments being monitored (rent, subscriptions) and reimbursement/split-payment trackers with their status.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
];

type Filters = {
  from?: string | null;
  to?: string | null;
  category?: string | null;
  merchant?: string | null;
  tag?: string | null;
  text?: string | null;
  direction?: "in" | "out" | "all";
  min_amount?: number | null;
  max_amount?: number | null;
};

async function loadCategories(
  db: Db
): Promise<Pick<Category, "id" | "name" | "parent_id">[]> {
  return db.selectFrom("categories").select(["id", "name", "parent_id"]).execute();
}

/** "Housing > Rent"-style paths for the full taxonomy, sorted. */
export async function categoryPaths(db: Db): Promise<string[]> {
  const categories = await loadCategories(db);
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categories
    .map((c) => {
      const parent = c.parent_id ? byId.get(c.parent_id) : null;
      return parent ? `${parent.name} > ${c.name}` : c.name;
    })
    .sort();
}

/** Compact one-line-per-parent taxonomy for the system prompt. */
export async function categoryTaxonomy(db: Db): Promise<string> {
  const categories = await loadCategories(db);
  return categories
    .filter((c) => !c.parent_id)
    .map((top) => {
      const children = categories
        .filter((c) => c.parent_id === top.id)
        .map((c) => c.name);
      return children.length ? `${top.name} (${children.join(", ")})` : top.name;
    })
    .join("\n");
}

async function resolveCategoryIds(db: Db, name: string): Promise<string[]> {
  const categories = await loadCategories(db);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const pathOf = (c: (typeof categories)[number]) => {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    return parent ? `${parent.name} > ${c.name}` : c.name;
  };
  const lower = name.trim().toLowerCase();
  // Exact match first (on name or full path), then prefix, then substring —
  // substring-first over-matched (e.g. "Income" also pulled "Other income").
  let direct = categories.filter(
    (c) => c.name.toLowerCase() === lower || pathOf(c).toLowerCase() === lower
  );
  if (direct.length === 0) {
    direct = categories.filter((c) => c.name.toLowerCase().startsWith(lower));
  }
  if (direct.length === 0) {
    direct = categories.filter((c) => c.name.toLowerCase().includes(lower));
  }
  const ids = new Set<string>();
  for (const c of direct) {
    ids.add(c.id);
    // Top-level category includes its children.
    for (const child of categories) {
      if (child.parent_id === c.id) ids.add(child.id);
    }
  }
  return [...ids];
}

type FetchedTx = {
  id: string;
  booking_date: string;
  amount: number;
  currency: string;
  raw_description: string;
  description: string | null;
  counterparty_name: string | null;
  tags: string[];
  category_name: string | null;
  merchant_name: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterFn = (qb: any) => any;

/**
 * Resolves name filters to id sets and returns a function that applies the
 * full WHERE clause to any query over `transactions`. Throws a descriptive
 * error on unresolvable category/merchant names — a silent empty result reads
 * as "no data" to the model and invites made-up answers.
 */
async function buildFilter(db: Db, filters: Filters): Promise<FilterFn> {
  let categoryIds: string[] | null = null;
  if (filters.category) {
    categoryIds = await resolveCategoryIds(db, filters.category);
    if (categoryIds.length === 0) {
      const paths = await categoryPaths(db);
      throw new Error(
        `No category matches "${filters.category}". Valid categories: ${paths.join("; ")}`
      );
    }
  }
  let merchantIds: string[] | null = null;
  if (filters.merchant) {
    const merchants = await db
      .selectFrom("merchants")
      .select("id")
      .where("canonical_name", "ilike", `%${filters.merchant}%`)
      .execute();
    merchantIds = merchants.map((m) => m.id);
    if (merchantIds.length === 0) {
      throw new Error(
        `No known merchant matches "${filters.merchant}". Use search_merchants to find the exact name, or use the text filter instead.`
      );
    }
  }

  return (qb) => {
    let q = qb;
    if (filters.from) q = q.where("transactions.booking_date", ">=", filters.from);
    if (filters.to) q = q.where("transactions.booking_date", "<=", filters.to);
    if (filters.direction === "out") q = q.where("transactions.amount", "<", 0);
    if (filters.direction === "in") q = q.where("transactions.amount", ">", 0);
    if (filters.tag) q = q.where("transactions.tags", "@>", [filters.tag]);
    if (filters.text) {
      const pattern = `%${filters.text}%`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      q = q.where((eb: any) =>
        eb.or([
          eb("transactions.raw_description", "ilike", pattern),
          eb("transactions.description", "ilike", pattern),
          eb("transactions.counterparty_name", "ilike", pattern),
        ])
      );
    }
    if (filters.min_amount != null) {
      q = q.where(sql`abs(transactions.amount)`, ">=", filters.min_amount);
    }
    if (filters.max_amount != null) {
      q = q.where(sql`abs(transactions.amount)`, "<=", filters.max_amount);
    }
    if (categoryIds) q = q.where("transactions.category_id", "in", categoryIds);
    if (merchantIds) q = q.where("transactions.merchant_id", "in", merchantIds);
    return q;
  };
}

async function fetchFiltered(
  db: Db,
  filters: Filters,
  limit: number,
  offset = 0
): Promise<{
  rows: FetchedTx[];
  count: number;
  total: number;
  spent: number;
  received: number;
}> {
  const applyFilters = await buildFilter(db, filters);

  // Totals over ALL matches, not just the returned page.
  const countRow = await applyFilters(
    db.selectFrom("transactions").select([
      db.fn.countAll().as("count"),
      sql<string>`coalesce(sum(transactions.amount), 0)`.as("total"),
      sql<string>`coalesce(sum(case when transactions.amount < 0 then -transactions.amount else 0 end), 0)`.as(
        "spent"
      ),
      sql<string>`coalesce(sum(case when transactions.amount > 0 then transactions.amount else 0 end), 0)`.as(
        "received"
      ),
    ])
  ).executeTakeFirst();

  const rows: FetchedTx[] = await applyFilters(db.selectFrom("transactions"))
    .leftJoin("categories", "categories.id", "transactions.category_id")
    .leftJoin("merchants", "merchants.id", "transactions.merchant_id")
    .select([
      "transactions.id",
      "transactions.booking_date",
      "transactions.amount",
      "transactions.currency",
      "transactions.raw_description",
      "transactions.description",
      "transactions.counterparty_name",
      "transactions.tags",
      "categories.name as category_name",
      "merchants.canonical_name as merchant_name",
    ])
    .orderBy("transactions.booking_date", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    rows,
    count: Number(countRow?.count ?? 0),
    total: Number(countRow?.total ?? 0),
    spent: Number(countRow?.spent ?? 0),
    received: Number(countRow?.received ?? 0),
  };
}

function toTxRow(r: FetchedTx): TxRow {
  return {
    id: r.id,
    booking_date: r.booking_date,
    amount: Number(r.amount),
    currency: r.currency,
    label:
      r.merchant_name || r.description || r.counterparty_name || r.raw_description,
    category: r.category_name,
    merchant: r.merchant_name,
    tags: r.tags,
  };
}

export async function executeTool(
  db: Db,
  name: string,
  input: unknown
): Promise<{ forModel: string; render: ToolRenderData | null; label: string }> {
  const args = (input ?? {}) as Filters & {
    group_by?: AggregateResult["group_by"];
    query?: string;
    limit?: number | null;
    offset?: number | null;
  };

  switch (name) {
    case "query_transactions": {
      const limit = Math.min(Math.max(Math.trunc(Number(args.limit) || 50), 1), 200);
      const offset = Math.max(Math.trunc(Number(args.offset) || 0), 0);
      const { rows, count, total, spent, received } = await fetchFiltered(
        db,
        args,
        limit,
        offset
      );
      const txRows = rows.map(toTxRow);
      const result: QueryTransactionsResult = {
        rows: txRows,
        total_count: count,
        total_amount: total,
        total_spent: spent,
        total_received: received,
        truncated: count > offset + txRows.length,
      };
      return {
        forModel: JSON.stringify(result),
        render: { tool: "query_transactions", result },
        label: "Searched transactions",
      };
    }

    case "aggregate_transactions": {
      const groupBy = args.group_by ?? "category";
      let sorted: AggregateBucket[];
      let bucketCount: number;

      if (groupBy === "tag") {
        // tags is an array column; bucketing the (bounded) rows in JS beats
        // an unnest query for this dataset size.
        const { rows } = await fetchFiltered(db, args, 5000);
        const buckets = new Map<
          string,
          { spent: number; received: number; net: number; count: number }
        >();
        for (const r of rows) {
          const amount = Number(r.amount);
          const key = r.tags.length > 0 ? r.tags.join(", ") : "(untagged)";
          const b = buckets.get(key) ?? { spent: 0, received: 0, net: 0, count: 0 };
          if (amount < 0) b.spent += -amount;
          else b.received += amount;
          b.net += amount;
          b.count += 1;
          buckets.set(key, b);
        }
        const all = [...buckets.entries()]
          .map(([key, b]) => ({ key, ...b }))
          .sort((a, b) => b.spent - a.spent);
        bucketCount = all.length;
        sorted = all.slice(0, 30);
      } else {
        const applyFilters = await buildFilter(db, args);
        const keyExpr =
          groupBy === "month"
            ? sql<string>`to_char(transactions.booking_date, 'YYYY-MM')`
            : groupBy === "merchant"
              ? sql<string>`coalesce(merchants.canonical_name, '(no merchant)')`
              : sql<string>`coalesce(categories.name, 'Uncategorized')`;
        const grouped: {
          key: string;
          spent: string;
          received: string;
          net: string;
          count: string;
        }[] = await applyFilters(
          db
            .selectFrom("transactions")
            .leftJoin("categories", "categories.id", "transactions.category_id")
            .leftJoin("merchants", "merchants.id", "transactions.merchant_id")
        )
          .select([
            keyExpr.as("key"),
            sql<string>`coalesce(sum(case when transactions.amount < 0 then -transactions.amount else 0 end), 0)`.as(
              "spent"
            ),
            sql<string>`coalesce(sum(case when transactions.amount > 0 then transactions.amount else 0 end), 0)`.as(
              "received"
            ),
            sql<string>`coalesce(sum(transactions.amount), 0)`.as("net"),
            sql<string>`count(*)`.as("count"),
          ])
          .groupBy(keyExpr)
          .execute();
        const all = grouped
          .map((g) => ({
            key: g.key,
            spent: Number(g.spent),
            received: Number(g.received),
            net: Number(g.net),
            count: Number(g.count),
          }))
          .sort((a, b) =>
            groupBy === "month" ? a.key.localeCompare(b.key) : b.spent - a.spent
          );
        bucketCount = all.length;
        sorted = all.slice(0, 30);
      }

      const result: AggregateResult = {
        group_by: groupBy,
        buckets: sorted,
        bucket_count: bucketCount,
      };
      return {
        forModel: JSON.stringify(result),
        render: { tool: "aggregate_transactions", result },
        label: `Aggregated by ${groupBy}`,
      };
    }

    case "list_categories": {
      return {
        forModel: JSON.stringify(await categoryPaths(db)),
        render: null,
        label: "Looked up categories",
      };
    }

    case "search_merchants": {
      const merchants = await db
        .selectFrom("merchants")
        .select(["canonical_name", "parent_brand", "match_patterns"])
        .where("canonical_name", "ilike", `%${args.query ?? ""}%`)
        .limit(20)
        .execute();
      return {
        forModel: JSON.stringify(merchants),
        render: null,
        label: `Searched merchants for “${args.query}”`,
      };
    }

    case "get_open_insights": {
      const insights = await db
        .selectFrom("insights")
        .select(["type", "severity", "title", "body", "created_at"])
        .where("status", "=", "open")
        .orderBy("created_at", "desc")
        .limit(25)
        .execute();
      return {
        forModel: JSON.stringify(insights),
        render: null,
        label: "Checked open flags",
      };
    }

    case "list_expectations": {
      const expectations = await db
        .selectFrom("expectations")
        .select([
          "kind",
          "label",
          "expected_amount",
          "cadence",
          "counterpart_count",
          "status",
          "created_at",
        ])
        .orderBy("created_at", "desc")
        .limit(50)
        .execute();
      return {
        forModel: JSON.stringify(expectations),
        render: null,
        label: "Checked tracked expectations",
      };
    }

    default:
      return {
        forModel: JSON.stringify({ error: `Unknown tool ${name}` }),
        render: null,
        label: name,
      };
  }
}
