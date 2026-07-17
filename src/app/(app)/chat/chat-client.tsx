"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, SendHorizonal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ToolRender } from "@/components/chat/registry";
import type { AssistantBlock, ChatEvent, StoredMessage } from "@/lib/chat/types";

type Conversation = { id: string; title: string | null; created_at: string };

type LiveMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; blocks: AssistantBlock[]; pending?: string | null };

const SUGGESTIONS = [
  "How much did I spend on groceries last month?",
  "What are my biggest expenses this year?",
  "Show my rent payments month by month — did I miss any?",
];

export function ChatClient({
  conversations,
  activeConversationId,
  initialMessages,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  initialMessages: StoredMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<LiveMessage[]>(() =>
    initialMessages.map((m) =>
      m.role === "user"
        ? { role: "user", text: m.content.text ?? "" }
        : { role: "assistant", blocks: m.content.blocks ?? [] }
    )
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState(activeConversationId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setInput("");
    setMessages((m) => [
      ...m,
      { role: "user", text },
      { role: "assistant", blocks: [], pending: "Thinking…" },
    ]);

    const updateAssistant = (fn: (prev: LiveMessage & { role: "assistant" }) => LiveMessage) =>
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = fn(last);
        }
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, message: text }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let newConvId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          switch (event.type) {
            case "conversation":
              newConvId = event.id;
              break;
            case "text":
              updateAssistant((prev) => {
                const blocks = [...prev.blocks];
                const last = blocks[blocks.length - 1];
                if (last?.type === "text") {
                  blocks[blocks.length - 1] = {
                    type: "text",
                    text: last.text + event.text,
                  };
                } else {
                  blocks.push({ type: "text", text: event.text });
                }
                return { ...prev, blocks, pending: null };
              });
              break;
            case "tool_start":
              updateAssistant((prev) => ({ ...prev, pending: `${event.label}…` }));
              break;
            case "tool_result":
              updateAssistant((prev) => ({
                ...prev,
                pending: null,
                blocks: event.render
                  ? [...prev.blocks, { type: "tool", label: event.label, render: event.render }]
                  : prev.blocks,
              }));
              break;
            case "error":
              updateAssistant((prev) => ({
                ...prev,
                pending: null,
                blocks: [
                  ...prev.blocks,
                  { type: "text", text: `Something went wrong: ${event.message}` },
                ],
              }));
              break;
            case "done":
              updateAssistant((prev) => ({ ...prev, pending: null }));
              break;
          }
        }
      }

      if (newConvId && newConvId !== convId) {
        setConvId(newConvId);
        window.history.replaceState(null, "", `/chat?c=${newConvId}`);
        router.refresh();
      }
    } catch (err) {
      updateAssistant((prev) => ({
        ...prev,
        pending: null,
        blocks: [
          ...prev.blocks,
          {
            type: "text",
            text: `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4">
      {/* Conversation list */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 md:flex">
        <Link
          href="/chat"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mb-2 justify-start")}
        >
          <Plus className="h-3.5 w-3.5" /> New chat
        </Link>
        <div className="flex-1 space-y-0.5 overflow-y-auto">
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/chat?c=${c.id}`}
              className={cn(
                "block truncate rounded-md px-2.5 py-1.5 text-sm hover:bg-muted",
                c.id === convId ? "bg-muted font-medium" : "text-muted-foreground"
              )}
            >
              {c.title ?? "Untitled"}
            </Link>
          ))}
        </div>
      </aside>

      {/* Messages */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-muted-foreground">
                Ask anything about your finances.
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="max-w-[95%] space-y-3">
                {m.blocks.map((b, j) =>
                  b.type === "text" ? (
                    <p key={j} className="whitespace-pre-wrap text-sm leading-relaxed">
                      {b.text}
                    </p>
                  ) : b.render ? (
                    <ToolRender key={j} data={b.render} />
                  ) : null
                )}
                {m.pending && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {m.pending}
                  </p>
                )}
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          className="flex items-end gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="How much did I spend on…"
            rows={1}
            className="min-h-9 flex-1 resize-none"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()}>
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
