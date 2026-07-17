"use client";

import { useTransition } from "react";
import { AlertTriangle, BellRing, Info, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteExpectation,
  setExpectationStatus,
  setInsightStatus,
} from "./actions";

export type InsightRow = {
  id: string;
  type: string;
  severity: "info" | "warning" | "alert";
  title: string;
  body: string | null;
  created_at: string;
};

export type ProposedExpectation = {
  id: string;
  label: string;
  expected_amount: number | null;
  cadence: string | null;
};

const SEVERITY_ICON = {
  info: Info,
  warning: AlertTriangle,
  alert: BellRing,
};

const SEVERITY_COLOR = {
  info: "text-sky-600",
  warning: "text-amber-600",
  alert: "text-[#e11d48]",
};

export function InsightsPanel({
  insights,
  proposals,
}: {
  insights: InsightRow[];
  proposals: ProposedExpectation[];
}) {
  const [pending, startTransition] = useTransition();

  if (insights.length === 0 && proposals.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Needs your attention</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {proposals.map((p) => (
          <div
            key={p.id}
            className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3"
          >
            <div className="flex gap-2.5">
              <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="text-sm">
                <p className="font-medium">
                  Recurring payment detected: {p.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  ~€{p.expected_amount ?? "?"} {p.cadence ?? "monthly"}. Track it
                  so missed months get flagged?
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="xs"
                disabled={pending}
                onClick={() =>
                  startTransition(() => setExpectationStatus(p.id, "active"))
                }
              >
                Track
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() => startTransition(() => deleteExpectation(p.id))}
              >
                Ignore
              </Button>
            </div>
          </div>
        ))}

        {insights.map((insight) => {
          const Icon = SEVERITY_ICON[insight.severity];
          return (
            <div
              key={insight.id}
              className="flex items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex gap-2.5">
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${SEVERITY_COLOR[insight.severity]}`}
                />
                <div className="text-sm">
                  <p className="font-medium">{insight.title}</p>
                  {insight.body && (
                    <p className="text-xs text-muted-foreground">{insight.body}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {insight.type.replaceAll("_", " ")}
                </Badge>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(() => setInsightStatus(insight.id, "resolved"))
                  }
                >
                  Resolve
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(() => setInsightStatus(insight.id, "dismissed"))
                  }
                >
                  Dismiss
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
