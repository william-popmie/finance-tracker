import { db } from "@/lib/db";
import type { StoredMessage } from "@/lib/chat/types";
import { ChatClient } from "./chat-client";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; tx?: string }>;
}) {
  const { c: conversationId, tx } = await searchParams;
  const contextIds = tx ? tx.split(",").filter(Boolean).slice(0, 100) : [];

  const [conversations, messages, contextTransactions] = await Promise.all([
    db
      .selectFrom("chat_conversations")
      .select(["id", "title", "created_at"])
      .orderBy("created_at", "desc")
      .limit(50)
      .execute(),
    conversationId
      ? db
          .selectFrom("chat_messages")
          .select(["id", "role", "content", "created_at"])
          .where("conversation_id", "=", conversationId)
          .orderBy("created_at", "asc")
          .execute()
      : Promise.resolve([]),
    contextIds.length
      ? db
          .selectFrom("transactions")
          .leftJoin("merchants", "merchants.id", "transactions.merchant_id")
          .select([
            "transactions.id",
            "transactions.booking_date",
            "transactions.amount",
            "transactions.description",
            "transactions.counterparty_name",
            "merchants.canonical_name as merchant",
          ])
          .where("transactions.id", "in", contextIds)
          .orderBy("transactions.booking_date", "desc")
          .execute()
      : Promise.resolve([]),
  ]);

  return (
    <ChatClient
      key={conversationId ?? "new"}
      conversations={conversations}
      activeConversationId={conversationId ?? null}
      initialMessages={messages as StoredMessage[]}
      contextTransactions={contextTransactions.map((t) => ({
        id: t.id,
        label: `${t.booking_date} · ${t.merchant ?? t.description ?? t.counterparty_name ?? "?"} · ${t.amount}`,
      }))}
    />
  );
}
