import { db } from "@/lib/db";
import type { StoredMessage } from "@/lib/chat/types";
import { ChatClient } from "./chat-client";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c: conversationId } = await searchParams;

  const [conversations, messages] = await Promise.all([
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
  ]);

  return (
    <ChatClient
      key={conversationId ?? "new"}
      conversations={conversations}
      activeConversationId={conversationId ?? null}
      initialMessages={messages as StoredMessage[]}
    />
  );
}
