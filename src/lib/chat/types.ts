// Shared types for the chat protocol: server streams NDJSON events, the
// client accumulates them into renderable blocks, and the final block list is
// persisted as the assistant message.

export type TxRow = {
  id: string;
  booking_date: string;
  amount: number;
  currency: string;
  label: string; // best available description
  category: string | null;
  merchant: string | null;
  tags: string[];
};

export type QueryTransactionsResult = {
  rows: TxRow[];
  total_count: number;
  total_amount: number;
  truncated: boolean;
};

export type AggregateBucket = {
  key: string;
  spent: number;
  received: number;
  net: number;
  count: number;
};

export type AggregateResult = {
  group_by: "category" | "merchant" | "month" | "tag";
  buckets: AggregateBucket[];
};

export type ToolRenderData =
  | { tool: "query_transactions"; result: QueryTransactionsResult }
  | { tool: "aggregate_transactions"; result: AggregateResult };

/** One block of an assistant message, in display order. */
export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool"; label: string; render: ToolRenderData | null };

export type ChatEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; label: string }
  | { type: "tool_result"; label: string; render: ToolRenderData | null }
  | { type: "error"; message: string }
  | { type: "done" };

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: {
    text?: string;
    blocks?: AssistantBlock[];
    /** Transactions attached as context via "Add to chat". */
    contextTransactionIds?: string[];
  };
  created_at: string;
};
