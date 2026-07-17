"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Statement } from "@/lib/types";

const STATUS_VARIANT: Record<Statement["status"], "default" | "secondary" | "destructive" | "outline"> = {
  parsed: "default",
  parsing: "secondary",
  uploaded: "outline",
  error: "destructive",
};

export function StatementRow({ statement }: { statement: Statement }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reparse() {
    setBusy(true);
    try {
      await fetch("/api/statements/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statementId: statement.id }),
      });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <li className="flex items-center justify-between gap-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{statement.file_name}</p>
        <p className="text-xs text-muted-foreground">
          {statement.period_start && statement.period_end
            ? `${statement.period_start} → ${statement.period_end} · `
            : ""}
          {statement.transaction_count != null
            ? `${statement.transaction_count} transactions · `
            : ""}
          uploaded {new Date(statement.created_at).toLocaleDateString()}
        </p>
        {statement.status === "error" && statement.error_msg && (
          <p className="mt-1 text-xs text-destructive">{statement.error_msg}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={STATUS_VARIANT[statement.status]}>
          {statement.status}
        </Badge>
        <Button size="sm" variant="outline" onClick={reparse} disabled={busy}>
          {busy ? "Parsing…" : "Re-parse"}
        </Button>
      </div>
    </li>
  );
}
