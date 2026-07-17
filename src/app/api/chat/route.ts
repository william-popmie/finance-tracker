import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { anthropic, MODELS } from "@/lib/ai/config";
import { CHAT_TOOLS, executeTool } from "@/lib/chat/tools";
import type { AssistantBlock, ChatEvent, StoredMessage } from "@/lib/chat/types";

export const maxDuration = 300;

const SYSTEM_STABLE = `You are the AI assistant inside a personal finance tracker. The user is Belgian; amounts are in EUR unless stated otherwise. Their bank transactions live in a database you query through tools.

How to work:
- Use aggregate_transactions for "how much" questions and for recurring-payment checks (group_by "month" reveals missing or double months).
- Use query_transactions when the user should see the individual transactions.
- If a category or merchant name might not match exactly, check with list_categories / search_merchants first.
- Tool results are ALSO shown to the user as tables and charts, so don't repeat every row in prose — summarize the answer and point out what matters (totals, anomalies, missing months, who still owes money).
- Amounts are signed: negative = money out. When reporting "spending", use the spent totals.
- Be concise and concrete. Lead with the answer, then the supporting detail.
- Write plain text — no markdown syntax like ** or ## (the UI renders your text verbatim). Simple dashes for lists are fine.
- If the data genuinely can't answer the question, say so and suggest what's missing (e.g. a statement period that was never uploaded).`;

export async function POST(req: Request) {
  const { conversationId, message } = (await req.json()) as {
    conversationId?: string | null;
    message?: string;
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
  // prose carries the durable context).
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
      content: JSON.stringify({ text: message }),
    })
    .execute();

  const priorMessages: Anthropic.MessageParam[] = history
    .map((m): Anthropic.MessageParam | null => {
      if (m.role === "user") {
        return m.content.text ? { role: "user", content: m.content.text } : null;
      }
      const text = (m.content.blocks ?? [])
        .filter((b): b is Extract<AssistantBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return text ? { role: "assistant", content: text } : null;
    })
    .filter((m): m is Anthropic.MessageParam => m !== null);

  const encoder = new TextEncoder();
  const conversationIdFinal = convId!;

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
        let messages: Anthropic.MessageParam[] = [
          ...priorMessages,
          { role: "user", content: message },
        ];

        for (let turn = 0; turn < 12; turn++) {
          const msgStream = anthropic().messages.stream({
            model: MODELS.chat,
            max_tokens: 4000,
            system: [
              {
                type: "text",
                text: SYSTEM_STABLE,
                cache_control: { type: "ephemeral" },
              },
              {
                type: "text",
                text: `Today's date: ${new Date().toISOString().slice(0, 10)}`,
              },
            ],
            tools: CHAT_TOOLS,
            messages,
          });

          msgStream.on("text", (delta) => {
            pushText(delta);
            emit({ type: "text", text: delta });
          });

          const response = await msgStream.finalMessage();

          if (response.stop_reason === "pause_turn") {
            messages = [...messages, { role: "assistant", content: response.content }];
            continue;
          }

          if (response.stop_reason !== "tool_use") break;

          const toolUses = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );
          messages = [...messages, { role: "assistant", content: response.content }];

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const toolUse of toolUses) {
            emit({ type: "tool_start", label: toolUse.name });
            try {
              const { forModel, render, label } = await executeTool(
                db,
                toolUse.name,
                toolUse.input
              );
              if (render) {
                blocks.push({ type: "tool", label, render });
              }
              emit({ type: "tool_result", label, render });
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: forModel,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Error: ${msg}`,
                is_error: true,
              });
              emit({ type: "tool_result", label: `${toolUse.name} failed`, render: null });
            }
          }
          messages = [...messages, { role: "user", content: toolResults }];
        }

        await db
          .insertInto("chat_messages")
          .values({
            conversation_id: conversationIdFinal,
            role: "assistant",
            content: JSON.stringify({ blocks }),
          })
          .execute();

        emit({ type: "done" });
      } catch (err) {
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
