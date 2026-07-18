"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { CategorizationRun } from "@/lib/types";

type Status = {
  run: CategorizationRun | null;
  uncategorized: number;
  total: number;
};

/**
 * Live categorization progress, polled from GET /api/categorize while a run
 * is active. Refreshes the table when a run finishes so categories appear.
 */
export function CategorizationStatus() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const lastRunState = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/categorize");
      if (!res.ok) return;
      const body = (await res.json()) as Status;
      setStatus(body);

      // Refresh the (server-rendered) table when a run transitions state.
      const key = body.run ? `${body.run.id}:${body.run.status}` : null;
      if (key && lastRunState.current && key !== lastRunState.current) {
        router.refresh();
      }
      lastRunState.current = key;
    } catch {
      // Polling is best-effort; the next tick retries.
    }
  }, [router]);

  useEffect(() => {
    poll();
  }, [poll]);

  const running = status?.run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [running, poll]);

  if (!status?.run) return null;
  const { run, uncategorized } = status;
  const r = run!;
  const done = r.pattern_matched + r.ai_resolved;

  if (r.status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Categorizing… {done} of {r.total} done
      </span>
    );
  }

  if (r.status === "error") {
    return (
      <span className="text-xs text-destructive">
        Categorization failed: {r.error_msg ?? "unknown error"}
        {uncategorized > 0 && ` — ${uncategorized} left, retry with Categorize`}
      </span>
    );
  }

  // done — only show briefly-relevant info: recent finish or remaining work.
  const finishedAgo = r.finished_at
    ? Date.now() - new Date(r.finished_at).getTime()
    : Infinity;
  if (finishedAgo < 60_000) {
    return (
      <span className="text-xs text-emerald-600">
        Categorized {done} transactions
        {r.pattern_matched > 0 && ` (${r.pattern_matched} from cache)`}
      </span>
    );
  }
  return null;
}
