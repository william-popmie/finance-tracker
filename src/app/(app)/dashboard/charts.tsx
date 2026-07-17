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

// Validated palette (dataviz six-checks, light surface):
// teal = money in, rose = money out.
const INCOME_COLOR = "#0d9488";
const SPEND_COLOR = "#e11d48";

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
        <CartesianGrid vertical={false} stroke="#00000010" />
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
          cursor={{ fill: "#00000008" }}
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
            <span className="text-muted-foreground">{eur(d.value)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                backgroundColor: d.color ?? "#64748b",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
