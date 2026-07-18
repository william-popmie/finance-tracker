import type { Content, Part, FunctionCall } from "@google/genai";
import { db } from "@/lib/db";
import { gemini, MODELS } from "@/lib/ai/config";
import { CHAT_TOOLS, executeTool } from "@/lib/chat/tools";
import type { AssistantBlock, ChatEvent, StoredMessage } from "@/lib/chat/types";
import { log, logError } from "@/lib/log";

export const maxDuration = 300;

const MAX_CONTEXT_TX = 100;

const SYSTEM_STABLE = `You are the AI assistant inside a personal finance tracker. The user is Belgian; amounts are in EUR unless stated otherwise. Their bank transactions live in a database you query through tools.

How to work:
- Use aggregate_transactions for "how much" questions and for recurring-payment checks (group_by "month" reveals missing or double months).
- Use query_transactions when the user should see the individual transactions.
- If a category or merchant name might not match exactly, check with list_categories / search_merchants first.
- Tool results are ALSO shown to the user as tables and charts, so don't repeat every row in prose — summarize the answer and point out what matters (totals, anomalies, missing months, who still owes money).
- Amounts are signed: negative = money out. When reporting "spending", use the spent totals.
- Be concise and concrete. Lead with the answer, then the supporting detail.
- Write plain text — no markdown syntax like ** or ## (the UI renders your text verbatim). Simple dashes for lists are fine.
- If the data genuinely can't answer the question, say so and suggest what's missing (e.g. a statement period that was never uploaded).
- When the user message starts with an [Attached transactions] block, those are the specific rows the user selected and is asking about.`;

/** Format attached transactions into a context block for the model. */
async function contextBlock(ids: string[]): Promise<string | null> {
  const capped = ids.slice(0, MAX_CONTEXT_TX);
  if (capped.length === 0) return null;
  const rows = await db
    .selectFrom("transactions")
    .leftJoin("merchants", "merchants.id", "transactions.merchant_id")
    .leftJoin("categories", "categories.id", "transactions.category_id")
    .select([
      "transactions.id",
      "transactions.booking_date",
      "transactions.amount",
      "transactions.currency",
      "transactions.description",
      "transactions.raw_description",
      "transactions.counterparty_name",
      "transactions.tags",
      "merchants.canonical_name as merchant",
      "categories.name as category",
    ])
    .where("transactions.id", "in", capped)
    .orderBy("transactions.booking_date", "desc")
    .execute();
  if (rows.length === 0) return null;
  const lines = rows.map(
    (r) =>
      `${r.booking_date} | ${r.amount} ${r.currency} | ${
        r.merchant ?? r.description ?? r.counterparty_name ?? "?"
      } | ${r.category ?? "uncategorized"}` +
      (r.tags?.length ? ` | tags: ${r.tags.join(", ")}` : "") +
      ` | raw: "${r.raw_description.replace(/\s+/g, " ").slice(0, 120)}"`
  );
  return `[Attached transactions — the user is asking about these specific rows]\n${lines.join("\n")}`;
}

/** Model input text for a stored/incoming user message (+ its context). */
async function userTurnText(
  text: string,
  contextIds: string[] | undefined
): Promise<string> {
  if (!contextIds?.length) return text;
  const block = await contextBlock(contextIds);
  return block ? `${block}\n\n${text}` : text;
}

export async function POST(req: Request) {
  const { conversationId, message, contextTransactionIds } =
    (await req.json()) as {
      conversationId?: string | null;
      message?: string;
      contextTransactionIds?: string[];
    };
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "message required" }), {
      status: 400,
    });
  }

  // Find or create the conversation.
  let convId = conversationId ?? null;
  if (!convId) {
    const conv = await db
      .insertInto("chat_conversations")
      .values({ title: message.slice(0, 80) })
      .returning("id")
      .executeTakeFirstOrThrow();
    convId = conv.id;
  }

  // Prior turns (text only — tool renders are UI artifacts; the assistant's
  // prose carries the durable context). User turns with attached transactions
  // get their context block re-prepended so follow-ups keep the context.
  const history = (await db
    .selectFrom("chat_messages")
    .select(["id", "role", "content", "created_at"])
    .where("conversation_id", "=", convId)
    .orderBy("created_at", "asc")
    .limit(30)
    .execute()) as StoredMessage[];

  await db
    .insertInto("chat_messages")
    .values({
      conversation_id: convId,
      role: "user",
      content: JSON.stringify({
        text: message,
        ...(contextTransactionIds?.length ? { contextTransactionIds } : {}),
      }),
    })
    .execute();

  const priorTurns: Content[] = [];
  for (const m of history) {
    if (m.role === "user") {
      if (!m.content.text) continue;
      priorTurns.push({
        role: "user",
        parts: [
          {
            text: await userTurnText(
              m.content.text,
              m.content.contextTransactionIds
            ),
          },
        ],
      });
    } else {
      const text = (m.content.blocks ?? [])
        .filter((b): b is Extract<AssistantBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (text) priorTurns.push({ role: "model", parts: [{ text }] });
    }
  }

  const encoder = new TextEncoder();
  const conversationIdFinal = convId!;
  const userText = await userTurnText(message, contextTransactionIds);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatEvent) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      const blocks: AssistantBlock[] = [];
      const pushText = (text: string) => {
        const last = blocks[blocks.length - 1];
        if (last?.type === "text") last.text += text;
        else blocks.push({ type: "text", text });
      };

      emit({ type: "conversation", id: conversationIdFinal });

      try {
        const contents: Content[] = [
          ...priorTurns,
          { role: "user", parts: [{ text: userText }] },
        ];

        for (let turn = 0; turn < 12; turn++) {
          const msgStream = await gemini().models.generateContentStream({
            model: MODELS.chat,
            contents,
            config: {
              systemInstruction: `${SYSTEM_STABLE}\n\nToday's date: ${new Date().toISOString().slice(0, 10)}`,
              tools: [{ functionDeclarations: CHAT_TOOLS }],
              maxOutputTokens: 4000,
            },
          });

          const modelParts: Part[] = [];
          const calls: FunctionCall[] = [];
          for await (const chunk of msgStream) {
            for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
              if (part.text) {
                pushText(part.text);
                emit({ type: "text", text: part.text });
                modelParts.push({ text: part.text });
              }
              if (part.functionCall) {
                calls.push(part.functionCall);
                modelParts.push({ functionCall: part.functionCall });
              }
            }
          }

          if (calls.length === 0) break;

          contents.push({ role: "model", parts: modelParts });
          const responseParts: Part[] = [];
          for (const call of calls) {
            const name = call.name ?? "unknown_tool";
            emit({ type: "tool_start", label: name });
            try {
              const { forModel, render, label } = await executeTool(
                db,
                name,
                call.args ?? {}
              );
              if (render) {
                blocks.push({ type: "tool", label, render });
              }
              emit({ type: "tool_result", label, render });
              responseParts.push({
                functionResponse: { name, response: { result: forModel } },
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              responseParts.push({
                functionResponse: { name, response: { error: msg } },
              });
              emit({ type: "tool_result", label: `${name} failed`, render: null });
            }
          }
          contents.push({ role: "user", parts: responseParts });
        }

        await db
          .insertInto("chat_messages")
          .values({
            conversation_id: conversationIdFinal,
            role: "assistant",
            content: JSON.stringify({ blocks }),
          })
          .execute();

        log("chat", `turn complete in conversation ${conversationIdFinal}`);
        emit({ type: "done" });
      } catch (err) {
        logError("chat", "chat turn failed", err);
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
