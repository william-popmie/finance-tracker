import { z } from "zod";
import { gemini, generateJson, MODELS } from "./config";
import type { Db } from "@/lib/db";
import type { Category, Merchant } from "@/lib/types";
import { parseBnpDescriptor } from "@/lib/statements/bnp";
import { log, logError } from "@/lib/log";

/**
 * Categorization engine.
 *
 * Layer 1 (free): substring-match raw descriptors against the cached
 * `merchants.match_patterns`. Repeat merchants never touch the API.
 * Layer 2 (Gemini Flash): one JSON call per record resolving merchant,
 * category, tags, and a clean description. Low-confidence merchants get a
 * second call with Google-Search grounding before the final answer. Every
 * resolution creates/updates a merchant record so it is layer-1 forever after.
 */

type UncategorizedTx = {
  id: string;
  raw_description: string;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  amount: number;
  currency: string;
  booking_date: string;
};

const RecordResolutionSchema = z.object({
  merchant: z
    .object({
      canonical_name: z
        .string()
        .describe("Official business name, e.g. 'Carrefour Express'"),
      parent_brand: z
        .string()
        .nullable()
        .describe("Parent brand if a sub-branch, e.g. 'Carrefour'"),
      website: z.string().nullable(),
      match_pattern: z
        .string()
        .describe(
          "Distinctive literal substring copied verbatim from the descriptor that identifies this merchant in future statements. Never a regular expression, card number, date, or amount."
        ),
    })
    .nullable()
    .describe(
      "The identified business, or null for person-to-person transfers and unidentifiable rows"
    ),
  category_path: z
    .string()
    .describe("Exactly one path from the provided category list"),
  tags: z
    .array(z.string())
    .max(5)
    .describe(
      "1-3 short lowercase topical tags, e.g. ['coffee'], ['public-transport'], ['groceries']"
    ),
  description: z
    .string()
    .describe("Short clean human description, e.g. 'Groceries at Carrefour Express'"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("low = you do not actually know what this business is"),
});

type RecordResolution = z.infer<typeof RecordResolutionSchema>;

const CATEGORIZE_SYSTEM = `You categorize one bank transaction from a Belgian bank statement (descriptors are messy: card numbers, reference codes, Dutch/French text).

1. Identify the merchant behind the raw descriptor. Well-known names (Carrefour, Colruyt, Spar, bol.com, Amazon, Delhaize...) you know directly.
2. Pick the single best category_path from the provided list. Person-to-person transfers use the Transfers paths; salary and refunds use Income paths.
3. Give 1-3 short lowercase topical tags (e.g. coffee, groceries, public-transport).
4. Write a short clean description a human would recognize.
5. merchant.match_pattern must be the distinctive stable part of the descriptor (the shop name portion), copied verbatim — never a regex, card number, date, or amount.
6. If you are not confident which business this is, still give your best guess but set confidence to "low" — do NOT invent details.

Do not invent merchants for unclear person-to-person transfers — set merchant to null and rely on the counterparty name in the description.`;

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

const PATTERN_STOPWORDS = new Set([
  "BETALING",
  "PAIEMENT",
  "DEBETKAART",
  "NUMMER",
  "NUMERO",
  "BANKREFERENTIE",
  "REFERENCE",
  "BANQUE",
  "CONTACTLOOS",
  "BANCONTACT",
  "VISA",
  "DEBIT",
  "OVERSCHRIJVING",
  "MEDEDELING",
]);

/**
 * Coerce a model-proposed match pattern into a plain literal substring of the
 * raw descriptor (matchMerchant does substring matching — a regex like
 * "(?i)\bDELHAIZE\b" would never match). Returns null when nothing safe fits;
 * storing no pattern beats storing a wrong one.
 */
export function sanitizeMatchPattern(
  pattern: string,
  raw: string
): string | null {
  const upperRaw = raw.toUpperCase();
  const fits = (p: string) => p.length >= 3 && upperRaw.includes(p.toUpperCase());

  const stripped = pattern
    .replace(/\(\?[a-z-]+\)/gi, " ") // inline flags like (?i)
    .replace(/\\[a-zA-Z]/g, " ") // escapes like \b \d \w
    .replace(/[\\^$*+?[\](){}|]/g, " ") // remaining regex metacharacters
    .replace(/\s+/g, " ")
    .trim();
  if (fits(stripped)) return stripped;

  const candidate = parseBnpDescriptor(raw).merchantCandidate;
  if (candidate && fits(candidate)) return candidate;

  // Longest run of letters in the descriptor that isn't boilerplate.
  const tokens = upperRaw.match(/[A-ZÀ-Ü]{4,}/g) ?? [];
  const best = tokens
    .filter((t) => !PATTERN_STOPWORDS.has(t))
    .sort((a, b) => b.length - a.length)[0];
  return best ?? null;
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

// ---------------------------------------------------------------------------
// Per-record resolution (step 1: JSON call; step 2: grounded research when
// the model doesn't know the business).
// ---------------------------------------------------------------------------

function recordPrompt(
  tx: UncategorizedTx,
  categoryPaths: string[],
  knownMerchants: string[],
  research?: string
): string {
  const candidate = parseBnpDescriptor(tx.raw_description).merchantCandidate;
  return (
    `Category paths (choose exactly one):\n${categoryPaths.join("\n")}\n\n` +
    `Known merchants (reuse the exact canonical_name if one matches):\n${
      knownMerchants.join(", ") || "(none yet)"
    }\n\n` +
    `Transaction:\ndate=${tx.booking_date} amount=${tx.amount} ${tx.currency}\n` +
    `descriptor="${tx.raw_description}"\n` +
    (tx.counterparty_name ? `counterparty="${tx.counterparty_name}"\n` : "") +
    `likely merchant (deterministic pre-parse): "${candidate ?? "unknown"}"` +
    (research ? `\n\nWeb research about this business:\n${research}` : "")
  );
}

async function researchMerchant(
  guessName: string,
  raw: string
): Promise<string | null> {
  const response = await gemini().models.generateContent({
    model: MODELS.categorize,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `What kind of business is "${guessName}"? It appears on a Belgian bank statement as "${raw.replace(/\s+/g, " ")}". ` +
              `Answer in 2-3 sentences: official name, what they sell/do, website if known.`,
          },
        ],
      },
    ],
    config: {
      tools: [{ googleSearch: {} }],
      maxOutputTokens: 1000,
    },
  });
  return response.text ?? null;
}

async function resolveRecord(
  tx: UncategorizedTx,
  categoryPaths: string[],
  knownMerchants: string[]
): Promise<RecordResolution> {
  const step1 = await generateJson({
    model: MODELS.categorize,
    schema: RecordResolutionSchema,
    system: CATEGORIZE_SYSTEM,
    parts: [{ text: recordPrompt(tx, categoryPaths, knownMerchants) }],
    maxOutputTokens: 1500,
    thinkingBudget: 0,
  });

  if (step1.confidence !== "low" || !step1.merchant) return step1;

  // Step 2: the model doesn't know this business — research it, then redo the
  // JSON call with the findings. Any failure falls back to the step-1 answer.
  try {
    log(
      "categorize",
      `"${step1.merchant.canonical_name}" low confidence — researching with Google Search`
    );
    const research = await researchMerchant(
      step1.merchant.canonical_name,
      tx.raw_description
    );
    if (!research) return step1;
    const step2 = await generateJson({
      model: MODELS.categorize,
      schema: RecordResolutionSchema,
      system: CATEGORIZE_SYSTEM,
      parts: [{ text: recordPrompt(tx, categoryPaths, knownMerchants, research) }],
      maxOutputTokens: 1500,
      thinkingBudget: 0,
    });
    log(
      "categorize",
      `research resolved "${step1.merchant.canonical_name}" -> "${step2.merchant?.canonical_name ?? "(none)"}" (${step2.category_path})`
    );
    return step2;
  } catch (err) {
    logError("categorize", "grounded research failed — using step-1 answer", err);
    return step1;
  }
}

// ---------------------------------------------------------------------------
// Merchant upsert — safe under concurrent workers: identical names share one
// in-flight promise, and the DB unique index on lower(canonical_name) backs
// up anything that slips through.
// ---------------------------------------------------------------------------

async function upsertMerchant(
  db: Db,
  resolution: NonNullable<RecordResolution["merchant"]>,
  categoryId: string | null,
  tags: string[],
  raw: string
): Promise<string> {
  const pattern = sanitizeMatchPattern(resolution.match_pattern, raw) ?? "";
  if (pattern !== resolution.match_pattern.trim()) {
    log(
      "categorize",
      `sanitized pattern "${resolution.match_pattern}" -> "${pattern || "(none)"}" for ${resolution.canonical_name}`
    );
  }

  const existing = await db
    .selectFrom("merchants")
    .select(["id", "match_patterns", "default_category_id", "default_tags"])
    .where("canonical_name", "ilike", resolution.canonical_name)
    .executeTakeFirst();

  if (existing) {
    const patterns = new Set<string>(existing.match_patterns ?? []);
    if (pattern.length >= 3) patterns.add(pattern);
    await db
      .updateTable("merchants")
      .set({
        match_patterns: [...patterns],
        default_category_id: existing.default_category_id ?? categoryId,
        default_tags: existing.default_tags?.length ? existing.default_tags : tags,
      })
      .where("id", "=", existing.id)
      .execute();
    return existing.id;
  }

  try {
    const created = await db
      .insertInto("merchants")
      .values({
        canonical_name: resolution.canonical_name,
        parent_brand: resolution.parent_brand,
        website: resolution.website,
        default_category_id: categoryId,
        match_patterns: pattern.length >= 3 ? [pattern] : [],
        default_tags: tags,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return created.id;
  } catch (err) {
    // Unique-index race with a parallel worker: the row exists now — reuse it.
    const raced = await db
      .selectFrom("merchants")
      .select("id")
      .where("canonical_name", "ilike", resolution.canonical_name)
      .executeTakeFirst();
    if (raced) return raced.id;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Run loop: Layer-1 sweep, then a small worker pool resolving one record per
// call. Progress is reported per record so the UI banner ticks smoothly.
// ---------------------------------------------------------------------------

const CONCURRENCY = 6;
const isRateLimit = (err: unknown) =>
  err instanceof Error && /429|RESOURCE_EXHAUSTED|quota/i.test(err.message);

export type CategorizationProgress = {
  patternMatched: number;
  aiResolved: number;
};

export async function runCategorization(
  db: Db,
  onProgress?: (p: CategorizationProgress) => Promise<void>
): Promise<CategorizationProgress> {
  const started = Date.now();
  const categories: Category[] = await db
    .selectFrom("categories")
    .select(["id", "name", "parent_id", "icon", "color"])
    .execute();
  const categoryPaths = buildCategoryPaths(categories);
  const pathList = [...categoryPaths.keys()];
  const otherId = categoryPaths.get("Other") ?? null;

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
      "currency",
      "booking_date",
    ])
    .where("category_id", "is", null)
    .orderBy("booking_date", "desc")
    .execute();

  let patternMatched = 0;
  let aiResolved = 0;
  if (uncategorized.length === 0) {
    log("categorize", "nothing to categorize");
    return { patternMatched, aiResolved };
  }

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
          tags: merchant.default_tags ?? [],
        })
        .where("id", "=", tx.id)
        .execute();
      patternMatched++;
    } else {
      unresolved.push(tx);
    }
  }
  log(
    "categorize",
    `${uncategorized.length} uncategorized: layer 1 matched ${patternMatched}, ${unresolved.length} need AI`
  );
  if (patternMatched > 0) await onProgress?.({ patternMatched, aiResolved });

  // Layer 2: per-record Gemini calls through a small worker pool.
  const knownMerchants = merchants.map((m) => m.canonical_name);
  const inFlightMerchants = new Map<string, Promise<string>>();
  let cursor = 0;
  let failures = 0;
  const failureBudget = Math.max(5, Math.ceil(unresolved.length * 0.3));

  async function handleRecord(tx: UncategorizedTx): Promise<void> {
    const r = await resolveRecord(tx, pathList, knownMerchants);
    const categoryId = categoryPaths.get(r.category_path) ?? otherId;

    let merchantId: string | null = null;
    if (r.merchant) {
      const key = r.merchant.canonical_name.toLowerCase();
      let pending = inFlightMerchants.get(key);
      if (!pending) {
        pending = upsertMerchant(
          db,
          r.merchant,
          categoryId,
          r.tags,
          tx.raw_description
        );
        inFlightMerchants.set(key, pending);
        pending.finally(() => inFlightMerchants.delete(key)).catch(() => {});
      }
      merchantId = await pending;
      if (!knownMerchants.some((n) => n.toLowerCase() === key)) {
        knownMerchants.push(r.merchant.canonical_name);
      }
    }

    await db
      .updateTable("transactions")
      .set({
        merchant_id: merchantId,
        category_id: categoryId,
        description: r.description,
        tags: r.tags,
      })
      .where("id", "=", tx.id)
      .execute();
    aiResolved++;
    log(
      "categorize",
      `resolved ${aiResolved}/${unresolved.length}: ${r.merchant?.canonical_name ?? "(p2p)"} -> ${r.category_path}` +
        (r.tags.length ? ` [${r.tags.join(", ")}]` : "")
    );
    await onProgress?.({ patternMatched, aiResolved });
  }

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= unresolved.length) return;
      if (failures > failureBudget) return;
      const tx = unresolved[i];
      try {
        await handleRecord(tx);
      } catch (err) {
        if (isRateLimit(err)) {
          log("categorize", "rate limited — backing off 15s and retrying");
          await new Promise((r) => setTimeout(r, 15_000));
        }
        try {
          await handleRecord(tx);
        } catch (err2) {
          failures++;
          logError(
            "categorize",
            `record failed twice (${failures}/${failureBudget}), falling back to Other: "${tx.raw_description.slice(0, 60).replace(/\s+/g, " ")}"`,
            err2
          );
          if (otherId) {
            await db
              .updateTable("transactions")
              .set({ category_id: otherId })
              .where("id", "=", tx.id)
              .execute();
          }
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, unresolved.length) }, worker)
  );

  if (failures > failureBudget) {
    throw new Error(
      `Categorization aborted: ${failures} of ${unresolved.length} records failed`
    );
  }

  log(
    "categorize",
    `done: ${patternMatched} pattern-matched, ${aiResolved} AI-resolved, ${failures} failed in ${((Date.now() - started) / 1000).toFixed(0)}s`
  );
  return { patternMatched, aiResolved };
}
