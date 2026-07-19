import type { Content, Part } from "@google/genai";
import type { StoredMessage } from "./types";

/**
 * Full tool payloads are replayed only for the last few assistant messages;
 * older calls keep the call/response skeleton with the payload elided, which
 * bounds context growth while still showing what was queried.
 */
const KEEP_TOOL_DATA_FOR_LAST = 2;

const OMITTED =
  "[result omitted to save space — re-run the tool if you need this data]";

/**
 * Rebuilds stored chat history as Gemini turns, replaying tool calls and
 * results as real functionCall/functionResponse pairs so follow-ups stay
 * grounded in data instead of the assistant's prose. Tool blocks persisted
 * before name/forModel existed are skipped — for those legacy messages only
 * the prose is replayed.
 */
export async function rebuildPriorTurns(
  history: StoredMessage[],
  userTurnText: (text: string, contextIds: string[] | undefined) => Promise<string>
): Promise<Content[]> {
  const assistantTotal = history.filter((m) => m.role === "assistant").length;
  let assistantSeen = 0;

  const priorTurns: Content[] = [];
  for (const m of history) {
    if (m.role === "user") {
      if (!m.content.text) continue;
      priorTurns.push({
        role: "user",
        parts: [
          { text: await userTurnText(m.content.text, m.content.contextTransactionIds) },
        ],
      });
    } else {
      assistantSeen++;
      const includeData = assistantSeen > assistantTotal - KEEP_TOOL_DATA_FOR_LAST;
      let parts: Part[] = [];
      const flush = () => {
        if (parts.length) {
          priorTurns.push({ role: "model", parts });
          parts = [];
        }
      };
      for (const b of m.content.blocks ?? []) {
        if (b.type === "text") {
          parts.push({ text: b.text });
        } else if (b.name) {
          parts.push({ functionCall: { name: b.name, args: b.args ?? {} } });
          flush();
          priorTurns.push({
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: b.name,
                  response: {
                    result: includeData && b.forModel ? b.forModel : OMITTED,
                  },
                },
              },
            ],
          });
        }
      }
      flush();
    }
  }
  return priorTurns;
}
