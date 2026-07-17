import Anthropic from "@anthropic-ai/sdk";

// One model constant per AI job so any of them can be re-pointed independently.
// User decision: Sonnet everywhere (cost ~$1.5–2.5/month steady state).
export const MODELS = {
  extract: "claude-sonnet-5",
  categorize: "claude-sonnet-5",
  chat: "claude-sonnet-5",
} as const;

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}
