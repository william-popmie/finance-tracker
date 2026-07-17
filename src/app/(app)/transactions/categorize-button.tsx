"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export function CategorizeButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/categorize", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed");
      setResult(
        `${body.patternMatched} matched from cache, ${body.aiResolved} resolved by AI`
      );
      router.refresh();
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
      <Button size="sm" variant="outline" onClick={run} disabled={busy}>
        <Sparkles className="h-3.5 w-3.5" />
        {busy ? "Categorizing…" : "Categorize"}
      </Button>
    </div>
  );
}
