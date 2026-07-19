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

import { categoryColor } from "@/lib/category-colors";

// Warm-paper palette: muted forest green = money in, burnt sienna = money out.
const INCOME_COLOR = "#4b6b52";
const SPEND_COLOR = "#c9754a";

function eur(n: number) {
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export type MonthlyPoint = { month: string; income: number; spent: number };

export function MonthlyTrendChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} barGap={2} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          tickFormatter={(v: number) => eur(v)}
          tickLine={false}
          axisLine={false}
          width={64}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <Tooltip
          formatter={(value, name) => [
            eur(Number(value)),
            name === "income" ? "Received" : "Spent",
          ]}
          cursor={{ fill: "var(--accent)" }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--popover-foreground)",
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
        />
        <Legend
          formatter={(value: string) => (
            <span className="text-xs text-muted-foreground">
              {value === "income" ? "Received" : "Spent"}
            </span>
          )}
        />
        <Bar dataKey="income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="spent" fill={SPEND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export type CategorySpend = {
  name: string;
  value: number;
  color: string | null;
};

// Direct-labeled horizontal bars: each row carries the category name in text
// ink, so identity never relies on color alone.
export function CategoryBars({ data }: { data: CategorySpend[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.name}>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-medium">{d.name}</span>
            <span className="figure text-muted-foreground">{eur(d.value)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                backgroundColor: categoryColor(d.name),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
