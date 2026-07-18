import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";

// One model constant per AI job so any of them can be re-pointed independently.
// User decision: Gemini 2.5 Flash everywhere (fast + cheap).
export const MODELS = {
  extract: "gemini-2.5-flash",
  categorize: "gemini-2.5-flash",
  chat: "gemini-2.5-flash",
} as const;

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({}); // reads GEMINI_API_KEY from env
  return client;
}

/**
 * Structured-output call: JSON mode constrained by a Zod schema, validated on
 * the way out. Shared by extraction, CSV mapping, and categorization.
 */
export async function generateJson<S extends z.ZodType>(opts: {
  model: string;
  schema: S;
  system: string;
  parts: Part[];
  maxOutputTokens?: number;
  /** 0 disables thinking for cheap high-volume calls. */
  thinkingBudget?: number;
}): Promise<z.infer<S>> {
  const response = await gemini().models.generateContent({
    model: opts.model,
    contents: [{ role: "user", parts: opts.parts }],
    config: {
      systemInstruction: opts.system,
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(opts.schema),
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      ...(opts.thinkingBudget != null
        ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } }
        : {}),
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error(
      `Model returned no text (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`
    );
  }
  try {
    return opts.schema.parse(JSON.parse(text));
  } catch (err) {
    throw new Error(
      `Structured output failed to parse (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}): ${err instanceof Error ? err.message : err}`
    );
  }
}
