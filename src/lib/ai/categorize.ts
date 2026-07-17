import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODELS } from "./config";
import type { Db } from "@/lib/db";
import type { Category, Merchant } from "@/lib/types";

/**
 * Categorization engine.
 *
 * Layer 1 (free): substring-match raw descriptors against the cached
 * `merchants.match_patterns`. Repeat merchants never touch the API.
 * Layer 2 (Claude + web search): unknown descriptors are identified in
 * batches; each resolution creates/updates a merchant record so it is
 * layer-1 forever after.
 */

type UncategorizedTx = {
  id: string;
  raw_description: string;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  amount: number;
};

const MerchantResolutionSchema = z.object({
  canonical_name: z.string(),
  parent_brand: z.string().nullable(),
  website: z.string().nullable(),
  match_pattern: z.string(),
});

const ResolutionSchema = z.object({
  transaction_index: z.number().int(),
  merchant: MerchantResolutionSchema.nullable(),
  category_path: z.string(),
  description: z.string(),
});

const ResolutionsInputSchema = z.object({
  resolutions: z.array(ResolutionSchema),
});

const SAVE_TOOL: Anthropic.Tool = {
  name: "save_merchant_resolutions",
  description:
    "Save the final categorization for every transaction in the batch. Call exactly once, after any research, with one resolution per transaction.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["resolutions"],
    properties: {
      resolutions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["transaction_index", "merchant", "category_path", "description"],
          properties: {
            transaction_index: {
              type: "integer",
              description: "Index of the transaction in the provided list",
            },
            merchant: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["canonical_name", "parent_brand", "website", "match_pattern"],
                  properties: {
                    canonical_name: {
                      type: "string",
                      description: "Official business name, e.g. 'Carrefour Express'",
                    },
                    parent_brand: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                      description: "Parent brand if a sub-branch, e.g. 'Carrefour'",
                    },
                    website: { anyOf: [{ type: "string" }, { type: "null" }] },
                    match_pattern: {
                      type: "string",
                      description:
                        "Distinctive substring of the raw descriptor that identifies this merchant in future statements, e.g. 'CARREFOUREXPRESS'. No card numbers or dates.",
                    },
                  },
                },
              ],
              description:
                "The identified business, or null for person-to-person transfers and unidentifiable rows",
            },
            category_path: {
              type: "string",
              description: "Exactly one path from the provided category list",
            },
            description: {
              type: "string",
              description:
                "Short clean human description, e.g. 'Groceries at Carrefour Express'",
            },
          },
        },
      },
    },
  },
};

const CATEGORIZE_SYSTEM = `You categorize bank transactions from Belgian bank statements (descriptors are messy: card numbers, reference codes, Dutch/French text).

For each transaction:
1. Identify the merchant behind the raw descriptor. Well-known names (Carrefour, Colruyt, Spar, bol.com, Amazon, Delhaize...) you know directly. For unfamiliar business names, use web_search to find what the business is — especially local Belgian shops.
2. Pick the single best category_path from the provided list. Person-to-person transfers use the Transfers paths; salary and refunds use Income paths.
3. Write a short clean description a human would recognize.
4. For merchant.match_pattern, choose the distinctive stable part of the descriptor (the shop name portion), never card numbers, dates, or amounts.

Do not invent merchants for unclear person-to-person transfers — set merchant to null and rely on the counterparty name in the description.

When you are done, call save_merchant_resolutions exactly once with a resolution for EVERY transaction index.`;

export function buildCategoryPaths(categories: Category[]): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const paths = new Map<string, string>(); // path -> category id
  for (const c of categories) {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    const path = parent ? `${parent.name} > ${c.name}` : c.name;
    paths.set(path, c.id);
  }
  return paths;
}

function matchMerchant(raw: string, merchants: Merchant[]): Merchant | null {
  const upper = raw.toUpperCase();
  for (const m of merchants) {
    if (
      m.match_patterns.some((p) => p.length >= 3 && upper.includes(p.toUpperCase()))
    ) {
      return m;
    }
  }
  return null;
}

async function resolveWithClaude(
  batch: UncategorizedTx[],
  categoryPaths: string[],
  knownMerchants: string[]
): Promise<z.infer<typeof ResolutionSchema>[]> {
  const txList = batch
    .map(
      (t, i) =>
        `${i}. amount=${t.amount} | descriptor="${t.raw_description}"${
          t.counterparty_name ? ` | counterparty="${t.counterparty_name}"` : ""
        }`
    )
    .join("\n");

  let messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Category paths (choose exactly one per transaction):\n${categoryPaths.join(
        "\n"
      )}\n\nAlready-known merchants (reuse the exact canonical_name if one of these matches):\n${
        knownMerchants.join(", ") || "(none yet)"
      }\n\nTransactions:\n${txList}`,
    },
  ];

  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await anthropic().messages.create({
      model: MODELS.categorize,
      max_tokens: 16000,
      system: CATEGORIZE_SYSTEM,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 8 },
        SAVE_TOOL,
      ],
      messages,
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "save_merchant_resolutions"
    );
    if (toolUse) {
      return ResolutionsInputSchema.parse(toolUse.input).resolutions;
    }

    if (response.stop_reason === "pause_turn") {
      // Server-side tool loop paused — resume where it left off.
      messages = [...messages, { role: "assistant", content: response.content }];
      continue;
    }

    // Finished talking without calling the tool — nudge once.
    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      {
        role: "user",
        content:
          "Call save_merchant_resolutions now with a resolution for every transaction index.",
      },
    ];
  }
  throw new Error("Categorization model never called save_merchant_resolutions");
}

async function upsertMerchant(
  db: Db,
  resolution: NonNullable<z.infer<typeof ResolutionSchema>["merchant"]>,
  categoryId: string | null
): Promise<string> {
  const existing = await db
    .selectFrom("merchants")
    .select(["id", "match_patterns", "default_category_id"])
    .where("canonical_name", "ilike", resolution.canonical_name)
    .executeTakeFirst();

  const pattern = resolution.match_pattern.trim();

  if (existing) {
    const patterns = new Set<string>(existing.match_patterns ?? []);
    if (pattern.length >= 3) patterns.add(pattern);
    await db
      .updateTable("merchants")
      .set({
        match_patterns: [...patterns],
        default_category_id: existing.default_category_id ?? categoryId,
      })
      .where("id", "=", existing.id)
      .execute();
    return existing.id;
  }

  const created = await db
    .insertInto("merchants")
    .values({
      canonical_name: resolution.canonical_name,
      parent_brand: resolution.parent_brand,
      website: resolution.website,
      default_category_id: categoryId,
      match_patterns: pattern.length >= 3 ? [pattern] : [],
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return created.id;
}

export async function runCategorization(
  db: Db
): Promise<{ patternMatched: number; aiResolved: number }> {
  const categories: Category[] = await db
    .selectFrom("categories")
    .select(["id", "name", "parent_id", "icon", "color"])
    .execute();
  const categoryPaths = buildCategoryPaths(categories);
  const otherId = categoryPaths.get("Other") ?? null;

  let patternMatched = 0;
  let aiResolved = 0;

  for (let round = 0; round < 6; round++) {
    const merchants: Merchant[] = await db
      .selectFrom("merchants")
      .selectAll()
      .execute();

    const uncategorized: UncategorizedTx[] = await db
      .selectFrom("transactions")
      .select([
        "id",
        "raw_description",
        "counterparty_name",
        "counterparty_iban",
        "amount",
      ])
      .where("category_id", "is", null)
      .orderBy("booking_date", "desc")
      .limit(200)
      .execute();
    if (uncategorized.length === 0) break;

    // Layer 1: free pattern matching against the merchant cache.
    const unresolved: UncategorizedTx[] = [];
    for (const tx of uncategorized) {
      const merchant = matchMerchant(tx.raw_description, merchants);
      if (merchant?.default_category_id) {
        await db
          .updateTable("transactions")
          .set({
            merchant_id: merchant.id,
            category_id: merchant.default_category_id,
            description: merchant.canonical_name,
          })
          .where("id", "=", tx.id)
          .execute();
        patternMatched++;
      } else {
        unresolved.push(tx);
      }
    }
    if (unresolved.length === 0) continue;

    // Layer 2: Claude + web search, one batch per round.
    const batch = unresolved.slice(0, 40);
    const resolutions = await resolveWithClaude(
      batch,
      [...categoryPaths.keys()],
      merchants.map((m) => m.canonical_name)
    );

    const resolvedIndexes = new Set<number>();
    for (const r of resolutions) {
      const tx = batch[r.transaction_index];
      if (!tx || resolvedIndexes.has(r.transaction_index)) continue;
      resolvedIndexes.add(r.transaction_index);

      const categoryId = categoryPaths.get(r.category_path) ?? otherId;
      const merchantId = r.merchant
        ? await upsertMerchant(db, r.merchant, categoryId)
        : null;

      await db
        .updateTable("transactions")
        .set({
          merchant_id: merchantId,
          category_id: categoryId,
          description: r.description,
        })
        .where("id", "=", tx.id)
        .execute();
      aiResolved++;
    }

    // Anything the model skipped falls back to Other so we never loop on it.
    for (let i = 0; i < batch.length; i++) {
      if (!resolvedIndexes.has(i) && otherId) {
        await db
          .updateTable("transactions")
          .set({ category_id: otherId })
          .where("id", "=", batch[i].id)
          .execute();
      }
    }
  }

  return { patternMatched, aiResolved };
}
