import type { FunctionDeclaration } from "@google/genai";
import type { Db } from "@/lib/db";
import type { Category } from "@/lib/types";
import type {
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
      "List individual transactions matching filters, newest first. Use this when the user wants to see specific transactions. Returns up to 50 rows plus the total count and sum of ALL matches.",
    parametersJsonSchema: {
      type: "object",
      required: FILTER_REQUIRED,
      properties: FILTER_PROPS,
    },
  },
  {
    name: "aggregate_transactions",
    description:
      "Sum and count transactions grouped by category, merchant, month, or tag — use this for 'how much did I spend on X' questions and for spotting missing months in recurring payments (group_by: 'month').",
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

async function resolveCategoryIds(db: Db, name: string): Promise<string[]> {
  const categories: Pick<Category, "id" | "name" | "parent_id">[] = await db
    .selectFrom("categories")
    .select(["id", "name", "parent_id"])
    .execute();
  const lower = name.trim().toLowerCase();
  const direct = categories.filter(
    (c) => c.name.toLowerCase() === lower || c.name.toLowerCase().includes(lower)
  );
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

async function fetchFiltered(
  db: Db,
  filters: Filters,
  limit: number
): Promise<{ rows: FetchedTx[]; count: number }> {
  // Resolve category/merchant name filters to id sets first.
  let categoryIds: string[] | null = null;
  if (filters.category) {
    categoryIds = await resolveCategoryIds(db, filters.category);
    if (categoryIds.length === 0) return { rows: [], count: 0 };
  }
  let merchantIds: string[] | null = null;
  if (filters.merchant) {
    const merchants = await db
      .selectFrom("merchants")
      .select("id")
      .where("canonical_name", "ilike", `%${filters.merchant}%`)
      .execute();
    merchantIds = merchants.map((m) => m.id);
    if (merchantIds.length === 0) return { rows: [], count: 0 };
  }

  // Applies the shared filter set to either the row query or the count query.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (qb: any): any => {
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
    if (categoryIds) q = q.where("transactions.category_id", "in", categoryIds);
    if (merchantIds) q = q.where("transactions.merchant_id", "in", merchantIds);
    return q;
  };

  const countRow = await applyFilters(
    db.selectFrom("transactions").select(db.fn.countAll().as("count"))
  ).executeTakeFirst();

  let rows: FetchedTx[] = await applyFilters(db.selectFrom("transactions"))
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
    .execute();

  // Absolute-amount bounds are applied in JS (they refer to magnitude).
  if (filters.min_amount != null) {
    rows = rows.filter((r) => Math.abs(Number(r.amount)) >= filters.min_amount!);
  }
  if (filters.max_amount != null) {
    rows = rows.filter((r) => Math.abs(Number(r.amount)) <= filters.max_amount!);
  }
  return { rows: rows as FetchedTx[], count: Number(countRow?.count ?? 0) };
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
  };

  switch (name) {
    case "query_transactions": {
      const { rows, count } = await fetchFiltered(db, args, 50);
      const txRows = rows.map(toTxRow);
      const result: QueryTransactionsResult = {
        rows: txRows,
        total_count: count,
        total_amount: txRows.reduce((s, r) => s + r.amount, 0),
        truncated: count > txRows.length,
      };
      return {
        forModel: JSON.stringify(result),
        render: { tool: "query_transactions", result },
        label: "Searched transactions",
      };
    }

    case "aggregate_transactions": {
      const { rows } = await fetchFiltered(db, args, 5000);
      const groupBy = args.group_by ?? "category";
      const buckets = new Map<
        string,
        { spent: number; received: number; net: number; count: number }
      >();
      for (const r of rows) {
        const amount = Number(r.amount);
        const key =
          groupBy === "month"
            ? r.booking_date.slice(0, 7)
            : groupBy === "merchant"
              ? (r.merchant_name ?? "(no merchant)")
              : groupBy === "tag"
                ? r.tags.length > 0
                  ? r.tags.join(", ")
                  : "(untagged)"
                : (r.category_name ?? "Uncategorized");
        const b = buckets.get(key) ?? { spent: 0, received: 0, net: 0, count: 0 };
        if (amount < 0) b.spent += -amount;
        else b.received += amount;
        b.net += amount;
        b.count += 1;
        buckets.set(key, b);
      }
      const sorted = [...buckets.entries()]
        .map(([key, b]) => ({ key, ...b }))
        .sort((a, b) =>
          groupBy === "month" ? a.key.localeCompare(b.key) : b.spent - a.spent
        )
        .slice(0, 30);
      const result: AggregateResult = { group_by: groupBy, buckets: sorted };
      return {
        forModel: JSON.stringify(result),
        render: { tool: "aggregate_transactions", result },
        label: `Aggregated by ${groupBy}`,
      };
    }

    case "list_categories": {
      const categories = await db
        .selectFrom("categories")
        .select(["id", "name", "parent_id"])
        .execute();
      const byId = new Map(categories.map((c) => [c.id, c]));
      const paths = categories.map((c) => {
        const parent = c.parent_id ? byId.get(c.parent_id) : null;
        return parent ? `${parent.name} > ${c.name}` : c.name;
      });
      return {
        forModel: JSON.stringify(paths.sort()),
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
