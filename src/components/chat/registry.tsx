"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AggregateResult,
  QueryTransactionsResult,
  ToolRenderData,
} from "@/lib/chat/types";

// Tool-result → component registry. Adding a renderable tool = one entry here.

const INCOME_COLOR = "#0d9488"; // validated pair (dataviz six-checks)
const SPEND_COLOR = "#e11d48";

function eur(n: number, currency = "EUR") {
  return new Intl.NumberFormat("nl-BE", { style: "currency", currency }).format(n);
}

export function ToolRender({ data }: { data: ToolRenderData }) {
  switch (data.tool) {
    case "query_transactions":
      return <TransactionListCard result={data.result} />;
    case "aggregate_transactions":
      return <AggregateCard result={data.result} />;
    default:
      return null;
  }
}

function TransactionListCard({ result }: { result: QueryTransactionsResult }) {
  if (result.rows.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        No matching transactions.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                  {r.booking_date}
                </td>
                <td className="max-w-64 truncate px-3 py-1.5">{r.label}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                  {r.category ?? "—"}
                </td>
                <td
                  className="whitespace-nowrap px-3 py-1.5 text-right font-medium"
                  style={{ color: r.amount < 0 ? SPEND_COLOR : INCOME_COLOR }}
                >
                  {eur(r.amount, r.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {result.total_count} transaction{result.total_count === 1 ? "" : "s"}
          {result.truncated ? ` (showing ${result.rows.length})` : ""}
        </span>
        <span className="font-medium text-foreground">
          Net: {eur(result.total_amount)}
        </span>
      </div>
    </div>
  );
}

function AggregateCard({ result }: { result: AggregateResult }) {
  if (result.buckets.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Nothing to aggregate for those filters.
      </div>
    );
  }

  if (result.group_by === "month") {
    return (
      <div className="rounded-lg border p-3">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={result.buckets}
            barGap={2}
            margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="#00000010" />
            <XAxis
              dataKey="key"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(v: number) => eur(v)}
              tickLine={false}
              axisLine={false}
              width={60}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              formatter={(value, name) => [
                eur(Number(value)),
                name === "received" ? "Received" : "Spent",
              ]}
              cursor={{ fill: "#00000008" }}
            />
            <Legend
              formatter={(value: string) => (
                <span className="text-xs text-muted-foreground">
                  {value === "received" ? "Received" : "Spent"}
                </span>
              )}
            />
            <Bar dataKey="spent" fill={SPEND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar
              dataKey="received"
              fill={INCOME_COLOR}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // category / merchant / tag: direct-labeled horizontal bars (spending).
  const max = Math.max(...result.buckets.map((b) => Math.max(b.spent, b.received)), 1);
  return (
    <div className="space-y-2 rounded-lg border p-4">
      {result.buckets.slice(0, 12).map((b) => {
        const value = b.spent > 0 ? b.spent : b.received;
        const isSpend = b.spent > 0;
        return (
          <div key={b.key}>
            <div className="mb-0.5 flex items-baseline justify-between text-sm">
              <span className="font-medium">{b.key}</span>
              <span className="text-muted-foreground">
                {eur(value)} · {b.count}×
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${Math.max(2, (value / max) * 100)}%`,
                  backgroundColor: isSpend ? SPEND_COLOR : INCOME_COLOR,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
