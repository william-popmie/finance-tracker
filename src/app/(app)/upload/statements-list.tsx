"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { Statement } from "@/lib/types";
import { deleteStatements } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatementRow } from "./statement-row";

export function StatementsList({ statements }: { statements: Statement[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const allSelected =
    statements.length > 0 && statements.every((s) => selected.has(s.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDelete() {
    const ids = [...selected];
    if (
      !confirm(
        `Delete ${ids.length} statement${ids.length === 1 ? "" : "s"}? Their imported transactions and stored files are deleted too.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteStatements(ids);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3 border-b pb-2">
        <Checkbox
          checked={allSelected}
          indeterminate={selected.size > 0 && !allSelected}
          onChange={() =>
            setSelected(
              allSelected ? new Set() : new Set(statements.map((s) => s.id))
            )
          }
          aria-label="Select all statements"
        />
        <span className="text-xs text-muted-foreground">
          {selected.size > 0 ? `${selected.size} selected` : "Select all"}
        </span>
        {selected.size > 0 && (
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={handleDelete}
            className="ml-auto"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {pending ? "Deleting…" : `Delete selected (${selected.size})`}
          </Button>
        )}
      </div>
      <ul className="divide-y">
        {statements.map((s) => (
          <li key={s.id} className="flex items-center gap-3">
            <Checkbox
              checked={selected.has(s.id)}
              onChange={() => toggle(s.id)}
              aria-label={`Select ${s.file_name}`}
            />
            <div className="min-w-0 flex-1">
              <StatementRow statement={s} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
