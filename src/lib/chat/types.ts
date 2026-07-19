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
  /** Net / spent / received over ALL matches, not just the returned page. */
  total_amount: number;
  total_spent?: number;
  total_received?: number;
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
  /** True number of groups; buckets is truncated when this is larger. */
  bucket_count?: number;
};

export type ToolRenderData =
  | { tool: "query_transactions"; result: QueryTransactionsResult }
  | { tool: "aggregate_transactions"; result: AggregateResult };

/** One block of an assistant message, in display order. */
export type AssistantBlock =
  | { type: "text"; text: string }
  | {
      type: "tool";
      label: string;
      render: ToolRenderData | null;
      /**
       * Tool call + result as the model saw them, so history replay can
       * reconstruct real functionCall/functionResponse turns. Optional —
       * absent on messages persisted before this was added.
       */
      name?: string;
      args?: Record<string, unknown>;
      forModel?: string;
    };

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
